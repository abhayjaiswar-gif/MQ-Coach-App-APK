const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const err = (message, status = 400) => Object.assign(new Error(message), {
  status
});
const integer = (value, label, min = 0) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > 1000000) throw err(`${label} must be a whole number between ${min} and 1000000`);
  return n;
};
const key = (name, size) => String(name).trim().toLowerCase() + '\0' + String(size || '').trim().toLowerCase();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const period = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(new Date());
  const get = n => parts.find(p => p.type === n).value;
  return {
    year: Number(get('year')),
    month: MONTHS[Number(get('month')) - 1],
    number: Number(get('month')),
    day: `${get('year')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`
  };
};
const monthSort = "FIELD(e.`month`,'January','February','March','April','May','June','July','August','September','October','November','December')";
module.exports = function createInventoryService(db) {
  let ready;
  function migrate() {
    return ready || (ready = (async () => {
      const sql = fs.readFileSync(path.join(__dirname, '../migrations/inventory_movements.sql'), 'utf8').replace(/^\uFEFF/, '');
      for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
    })().catch(e => {
      ready = null;
      throw e;
    }));
  }
  async function actor(req) {
    const [[u]] = await db.query('SELECT id,role_id FROM users WHERE id=?', [req.user?.id]);
    if (!u) throw err('Login required', 401);
    return u;
  }
  const admin = u => [1, 2, 7].includes(Number(u.role_id));
  async function schoolIds(u) {
    if (admin(u)) return null;
    const [r] = await db.query(`SELECT school_id FROM assign_school WHERE user_id=? OR ssgm_id=? UNION SELECT school_id FROM lp_assign WHERE user_id=? UNION SELECT school_id FROM coach_lesson_tracking WHERE user_id=?`, [u.id, u.id, u.id, u.id]);
    return [...new Set(r.map(x => Number(x.school_id)).filter(Boolean))];
  }
  async function access(u, schoolId, write = false) {
    const sid = integer(schoolId, 'School', 1);
    if (write && ![1, 2, 3, 4, 7].includes(Number(u.role_id))) throw err('Head coach or stock manager access required', 403);
    const ids = await schoolIds(u);
    if (ids && !ids.includes(sid)) throw err('School access denied', 403);
    const [[s]] = await db.query('SELECT id,name FROM schools WHERE id=?', [sid]);
    if (!s) throw err('School not found', 404);
    return s;
  }
  async function transaction(schoolId, fn) {
    const c = await db.getConnection();
    try {
      await c.beginTransaction();
      await c.query('INSERT INTO inventory_school_locks(school_id) VALUES(?) ON DUPLICATE KEY UPDATE school_id=VALUES(school_id)', [schoolId]);
      await c.query('SELECT school_id FROM inventory_school_locks WHERE school_id=? FOR UPDATE', [schoolId]);
      const r = await fn(c);
      await c.commit();
      return r;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  async function latest(conn, schoolId, name = null, lock = false) {
    const p = period();
    const params = [schoolId, p.year, p.year, p.number];
    let where = '';
    if (name) {
      where = ' AND e.equipment_name=?';
      params.push(name);
    }
    const [rows] = await conn.query(`SELECT e.id equipment_id,e.school_id,e.equipment_name,e.\`month\`,e.\`year\`,v.id variant_id,v.size,v.quantity,v.damaged,v.\`condition\`,v.updated_at FROM school_inventory_equipments e JOIN school_inventory_equipment_variants v ON v.equipment_id=e.id WHERE e.school_id=? AND (e.\`year\`<? OR (e.\`year\`=? AND ${monthSort}<=?))${where} ORDER BY e.\`year\` DESC,${monthSort} DESC,v.id DESC${lock ? ' FOR UPDATE' : ''}`, params);
    const found = new Map();
    for (const r of rows) {
      const k = key(r.equipment_name, r.size);
      if (!found.has(k)) found.set(k, {
        ...r,
        size: r.size || '',
        quantity: Number(r.quantity),
        damaged: Number(r.damaged),
        usable: Math.max(0, Number(r.quantity) - Number(r.damaged)),
        count_issue: Number(r.damaged) > Number(r.quantity)
      });
    }
    return [...found.values()];
  }
  async function ensureCurrent(c, sid, name, size) {
    const p = period();
    const currentRows = await latest(c, sid, name, true);
    const [[eq]] = await c.query('SELECT id FROM school_inventory_equipments WHERE school_id=? AND equipment_name=? AND `month`=? AND `year`=? FOR UPDATE', [sid, name, p.month, p.year]);
    let eid = eq?.id;
    if (!eid) {
      const [r] = await c.query('INSERT INTO school_inventory_equipments(school_id,equipment_name,`month`,`year`) VALUES(?,?,?,?)', [sid, name, p.month, p.year]);
      eid = r.insertId;
    }
    const [existing] = await c.query('SELECT * FROM school_inventory_equipment_variants WHERE equipment_id=? ORDER BY id DESC FOR UPDATE', [eid]);
    const sizes = new Set(existing.map(r => String(r.size || '').trim().toLowerCase()));
    for (const row of currentRows) {
      if (!sizes.has(row.size.trim().toLowerCase())) {
        await c.query('INSERT INTO school_inventory_equipment_variants(equipment_id,size,quantity,damaged,`condition`) VALUES(?,?,?,?,?)', [eid, row.size || null, row.quantity, row.damaged, row.condition || 'Good']);
        sizes.add(row.size.trim().toLowerCase());
      }
    }
    let [[v]] = await c.query("SELECT * FROM school_inventory_equipment_variants WHERE equipment_id=? AND TRIM(COALESCE(size,''))=? ORDER BY id DESC LIMIT 1 FOR UPDATE", [eid, size]);
    if (!v) {
      const [r] = await c.query('INSERT INTO school_inventory_equipment_variants(equipment_id,size,quantity,damaged,`condition`) VALUES(?,?,0,0,?)', [eid, size || null, 'Good']);
      v = {
        id: r.insertId,
        quantity: 0,
        damaged: 0
      };
    }
    return v;
  }
  async function recipient(c, sid, type, id) {
    id = integer(id, 'Recipient', 1);
    let r;
    if (type === 'student') [[r]] = await c.query('SELECT id,name FROM students WHERE id=? AND school_id=?', [id, sid]);else if (type === 'team') [[r]] = await c.query('SELECT id,name FROM teams WHERE id=? AND school_id=?', [id, sid]);else if (type === 'coach') [[r]] = await c.query(`SELECT u.id,u.name FROM users u WHERE u.id=? AND u.role_id IN (4,5) AND (EXISTS(SELECT 1 FROM assign_school a WHERE a.school_id=? AND (a.user_id=u.id OR a.ssgm_id=u.id)) OR EXISTS(SELECT 1 FROM lp_assign l WHERE l.school_id=? AND l.user_id=u.id) OR EXISTS(SELECT 1 FROM coach_lesson_tracking t WHERE t.school_id=? AND t.user_id=u.id))`, [id, sid, sid, sid]);else throw err('Choose student, team or coach');
    if (!r) throw err('Recipient must belong to this school');
    return {
      type,
      id,
      name: r.name
    };
  }
  async function apply(c, m) {
    const v = await ensureCurrent(c, m.school_id, m.equipment_name, m.size || '');
    let q = Number(v.quantity),
      d = Number(v.damaged);
    const beforeQ = q,
      beforeD = d,
      n = Number(m.quantity);
    const lostLoan = m.movement_type === 'missing' && m.linked_issue_id;
    if (lostLoan) {
      const [[loan]] = await c.query("SELECT quantity FROM inventory_movements WHERE id=? AND school_id=? AND movement_type='issue' AND status='posted' FOR UPDATE", [m.linked_issue_id, m.school_id]);
      const [[closed]] = await c.query("SELECT COALESCE(SUM(quantity),0) n FROM inventory_movements WHERE linked_issue_id=? AND status='posted' AND movement_type IN ('return','missing')", [m.linked_issue_id]);
      if (!loan || n > loan.quantity - Number(closed.n)) throw err('Missing quantity exceeds the outstanding loan', 409);
    }
    if (d > q) throw err('Damaged count exceeds total. Correct the physical count first.', 409);
    const usable = q - d;
    if (['issue', 'damage', 'missing'].includes(m.movement_type) && !lostLoan && n > usable) throw err(`Only ${usable} usable items available`, 409);
    if (m.movement_type === 'receipt' || m.movement_type === 'return') q += n;
    if (m.movement_type === 'return') d += Number(m.returned_damaged || 0);
    if (m.movement_type === 'issue' || m.movement_type === 'missing' && !lostLoan) q -= n;
    if (m.movement_type === 'damage') d += n;
    if (q > 1000000) throw err('Stock exceeds the supported limit');
    const condition = d === 0 ? 'Good' : d === q ? 'Replace/Repair' : 'Attention';
    await c.query('UPDATE school_inventory_equipment_variants SET quantity=?,damaged=?,`condition`=? WHERE id=?', [q, d, condition, v.id]);
    await c.query("UPDATE inventory_movements SET status='posted',variant_id=?,before_quantity=?,after_quantity=?,before_damaged=?,after_damaged=?,posted_at=NOW() WHERE id=?", [v.id, beforeQ, q, beforeD, d, m.id]);
    return {
      before_quantity: beforeQ,
      after_quantity: q,
      before_damaged: beforeD,
      after_damaged: d,
      usable: q - d
    };
  }
  async function movements(u, body) {
    await migrate();
    const sid = integer(body.school_id, 'School', 1);
    await access(u, sid, true);
    const type = String(body.movement_type || '');
    if (!['receipt', 'issue', 'return', 'damage', 'missing'].includes(type)) throw err('Choose a stock action');
    const idKey = String(body.idempotency_key || '');
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(idKey)) throw err('A valid retry key is required');
    const request = {
      ...body
    };
    delete request.user_id;
    delete request.role_id;
    const fingerprint = hash(request);
    return transaction(sid, async c => {
      const [[existing]] = await c.query('SELECT * FROM inventory_movements WHERE school_id=? AND idempotency_key=?', [sid, idKey]);
      if (existing) {
        if (existing.request_hash !== fingerprint) throw err('This retry key was already used with different details', 409);
        return {
          movement: existing,
          duplicate: true
        };
      }
      const qty = integer(body.quantity, 'Quantity', 1);
      let name = String(body.equipment_name || '').trim(),
        size = String(body.size || '').trim();
      let who = {
          type: null,
          id: null,
          name: null
        },
        issueId = null,
        orderId = body.linked_order_id ? integer(body.linked_order_id, 'Order', 1) : null;
      const returnedDamaged = integer(body.returned_damaged || 0, 'Returned damaged');
      if (returnedDamaged > qty || type !== 'return' && returnedDamaged) throw err('Damaged returns cannot exceed the returned quantity');
      if (type === 'return' || type === 'missing' && body.linked_issue_id) {
        issueId = integer(body.linked_issue_id, 'Original loan', 1);
        const [[loan]] = await c.query("SELECT * FROM inventory_movements WHERE id=? AND school_id=? AND movement_type='issue' AND status='posted' FOR UPDATE", [issueId, sid]);
        if (!loan) throw err('Choose an outstanding loan from this school');
        const [[returned]] = await c.query("SELECT COALESCE(SUM(quantity),0) n FROM inventory_movements WHERE linked_issue_id=? AND status='posted' AND movement_type IN ('return','missing')", [issueId]);
        if (qty > loan.quantity - Number(returned.n)) throw err('Return exceeds the outstanding loan', 409);
        name = loan.equipment_name;
        size = loan.size;
        who = {
          type: loan.recipient_type,
          id: loan.recipient_id,
          name: loan.recipient_name
        };
      }
      if (type === 'issue') who = await recipient(c, sid, body.recipient_type, body.recipient_id);
      if (!name || name.length > 255 || size.length > 50) throw err('Choose an item and a valid size');
      if (orderId && type !== 'receipt') throw err('Only receipts may link an existing order');
      if (orderId) {
        const [[order]] = await c.query('SELECT * FROM equipment_order WHERE id=? AND school_id=? FOR UPDATE', [orderId, sid]);
        if (!order || order.approve_ssgm !== 1 || order.approve_admin !== 1) throw err('This request is not approved for receipt', 409);
        const [[loss]] = await c.query("SELECT id FROM inventory_movements WHERE linked_order_id=? AND movement_type='missing'", [orderId]);
        if (loss) throw err('This is a missing-item approval, not a purchase');
        if (key(order.sku_name, order.size) !== key(name, size)) throw err('Received item must match the request');
        const [[received]] = await c.query("SELECT COALESCE(SUM(quantity),0) n FROM inventory_movements WHERE linked_order_id=? AND movement_type='receipt' AND status='posted'", [orderId]);
        if (qty > Number(order.qty) - Number(received.n)) throw err('Receipt exceeds the remaining requested quantity', 409);
      }
      let status = type === 'missing' ? 'pending' : 'posted';
      if (type === 'missing') {
        const current = (await latest(c, sid, name)).find(v => key(name, size) === key(v.equipment_name, v.size));
        if (!issueId && (!current || qty > current.usable)) throw err('Missing quantity exceeds usable stock', 409);
        const [order] = await c.query('INSERT INTO equipment_order(sku_name,qty,school_id,size,user_id) VALUES(?,?,?,?,?)', [(issueId ? `[MISSING LOAN - approval only] ${name} - ${who.type}: ${who.name}` : `[MISSING - approval only] ${name}`).slice(0, 255), qty, sid, size, u.id]);
        orderId = order.insertId;
      }
      const due = body.due_date ? String(body.due_date) : null;
      if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(new Date(due + 'T00:00:00Z').getTime()) || new Date(due + 'T00:00:00Z').toISOString().slice(0, 10) !== due)) throw err('Use a valid return date (YYYY-MM-DD)');
      const [r] = await c.query(`INSERT INTO inventory_movements(school_id,equipment_name,size,movement_type,quantity,returned_damaged,recipient_type,recipient_id,recipient_name,linked_order_id,linked_issue_id,user_id,status,note,due_date,idempotency_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [sid, name, size, type, qty, returnedDamaged, who.type, who.id, who.name, orderId, issueId, u.id, status, String(body.note || '').slice(0, 2000), due, idKey, fingerprint]);
      const m = {
        id: r.insertId,
        school_id: sid,
        equipment_name: name,
        size,
        movement_type: type,
        quantity: qty,
        returned_damaged: returnedDamaged,
        linked_issue_id: issueId
      };
      if (status === 'posted') await apply(c, m);
      if (orderId && type === 'receipt') {
        const [[total]] = await c.query("SELECT SUM(quantity) n FROM inventory_movements WHERE linked_order_id=? AND movement_type='receipt' AND status='posted'", [orderId]);
        await c.query('UPDATE equipment_order SET status_delivery=IF(qty<=?,1,0) WHERE id=?', [Number(total.n), orderId]);
      }
      const [[saved]] = await c.query('SELECT * FROM inventory_movements WHERE id=?', [m.id]);
      return {
        movement: saved,
        duplicate: false
      };
    });
  }
  async function reconcileOne(id, retry = false) {
    const [[m]] = await db.query("SELECT * FROM inventory_movements WHERE id=? AND movement_type='missing' AND status IN ('pending','needs_review')", [id]);
    if (!m) return;
    return transaction(m.school_id, async c => {
      const [[row]] = await c.query('SELECT * FROM inventory_movements WHERE id=? FOR UPDATE', [id]);
      if (row.status !== 'pending' && !(retry && row.status === 'needs_review')) return;
      const [[o]] = await c.query('SELECT * FROM equipment_order WHERE id=? FOR UPDATE', [row.linked_order_id]);
      if (!o) return;
      if (o.approve_ssgm === 0 || o.approve_admin === 0) {
        await c.query("UPDATE inventory_movements SET status='rejected' WHERE id=?", [id]);
        return;
      }
      if (o.approve_ssgm === 1 && o.approve_admin === 1) {
        try {
          await apply(c, row);
        } catch (e) {
          if (!e.status) throw e;
          await c.query("UPDATE inventory_movements SET status='needs_review' WHERE id=?", [id]);
        }
      }
    });
  }
  let reconciling = false;
  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      await migrate();
      const [rows] = await db.query("SELECT m.id FROM inventory_movements m JOIN equipment_order o ON o.id=m.linked_order_id WHERE m.movement_type='missing' AND m.status='pending' AND (o.approve_ssgm=0 OR o.approve_admin=0 OR (o.approve_ssgm=1 AND o.approve_admin=1)) ORDER BY m.id LIMIT 100");
      for (const r of rows) await reconcileOne(r.id);
    } finally {
      reconciling = false;
    }
  }
  return {
    migrate,
    actor,
    admin,
    schoolIds,
    access,
    transaction,
    latest,
    ensureCurrent,
    recipient,
    movements,
    reconcile,
    reconcileOne,
    period,
    MONTHS,
    err,
    integer,
    hash
  };
};
