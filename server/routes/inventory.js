const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const createService = require('../services/inventoryService');
module.exports = function mountInventory(app, {
  db,
  UPLOADS_DIR
}) {
  const s = createService(db),
    {
      err,
      integer
    } = s;
  const wrap = fn => async (req, res, next) => {
    try {
      await s.migrate();
      req.inventoryUser = await s.actor(req);
      await fn(req, res);
    } catch (e) {
      if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(e.code)) return res.status(503).json({
        success: false,
        message: 'Stock is being updated. Please try again; your retry will not duplicate it.'
      });
      if (e.status || e.code === 'ER_DUP_ENTRY') return res.status(e.status || 409).json({
        success: false,
        message: e.status ? e.message : 'This item and month already exist'
      });
      next(e);
    }
  };
  const sid = req => integer(req.query.school_id || req.body.school_id || req.params.schoolId, 'School', 1);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
      fields: 15
    },
    fileFilter: (_r, f, cb) => cb(['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype) ? null : err('Use a JPEG, PNG or WebP image'), true)
  }).single('image');
  const multipart = (req, res, next) => upload(req, res, e => e ? res.status(400).json({
    success: false,
    message: e.message
  }) : next());
  app.get('/api/equipment/current', wrap(async (req, res) => {
    const school = await s.access(req.inventoryUser, sid(req));
    const stock = await s.latest(db, school.id);
    const [losses] = await db.query("SELECT equipment_name,size,SUM(IF(status='posted',quantity,0)) missing,SUM(IF(status IN ('pending','needs_review'),quantity,0)) pending_missing FROM inventory_movements WHERE school_id=? AND movement_type='missing' GROUP BY equipment_name,size", [school.id]);
    for (const row of stock) {
      const loss = losses.find(x => x.equipment_name.toLowerCase() === row.equipment_name.toLowerCase() && String(x.size || '').toLowerCase() === String(row.size || '').toLowerCase());
      row.missing = Number(loss?.missing || 0);
      row.pending_missing = Number(loss?.pending_missing || 0);
    }
    res.json({
      success: true,
      school,
      stock,
      not_counted_yet: stock.length === 0,
      period: s.period()
    });
  }));
  app.get('/api/equipment/recipients', wrap(async (req, res) => {
    const school = await s.access(req.inventoryUser, sid(req));
    const [students] = await db.query('SELECT id,name FROM students WHERE school_id=? ORDER BY name', [school.id]);
    const [teams] = await db.query('SELECT id,name FROM teams WHERE school_id=? ORDER BY name', [school.id]);
    const [coaches] = await db.query(`SELECT DISTINCT u.id,u.name FROM users u WHERE u.role_id IN (4,5) AND (EXISTS(SELECT 1 FROM assign_school a WHERE a.school_id=? AND (a.user_id=u.id OR a.ssgm_id=u.id)) OR EXISTS(SELECT 1 FROM lp_assign l WHERE l.school_id=? AND l.user_id=u.id) OR EXISTS(SELECT 1 FROM coach_lesson_tracking t WHERE t.school_id=? AND t.user_id=u.id)) ORDER BY u.name`, [school.id, school.id, school.id]);
    res.json({
      success: true,
      students,
      teams,
      coaches
    });
  }));
  app.get('/api/equipment/movements', wrap(async (req, res) => {
    await s.access(req.inventoryUser, sid(req));
    const before = req.query.before ? integer(req.query.before, 'Before ID', 1) : Number.MAX_SAFE_INTEGER;
    const [movements] = await db.query('SELECT m.*,u.name user_name FROM inventory_movements m LEFT JOIN users u ON u.id=m.user_id WHERE m.school_id=? AND m.id<? ORDER BY m.id DESC LIMIT 100', [sid(req), before]);
    res.json({
      success: true,
      movements,
      next_before: movements.length === 100 ? movements[99].id : null
    });
  }));
  app.get('/api/equipment/loans', wrap(async (req, res) => {
    await s.access(req.inventoryUser, sid(req));
    const [loans] = await db.query(`SELECT m.*,m.quantity-COALESCE(r.n,0) outstanding FROM inventory_movements m LEFT JOIN (SELECT linked_issue_id,SUM(quantity) n FROM inventory_movements WHERE movement_type IN ('return','missing') AND linked_issue_id IS NOT NULL AND status='posted' GROUP BY linked_issue_id) r ON r.linked_issue_id=m.id WHERE m.school_id=? AND m.movement_type='issue' AND m.status='posted' AND m.quantity>COALESCE(r.n,0) ORDER BY m.id DESC`, [sid(req)]);
    for (const loan of loans) loan.outstanding = Number(loan.outstanding);
    res.json({
      success: true,
      loans
    });
  }));
  app.post('/api/equipment/movements', wrap(async (req, res) => res.json({
    success: true,
    ...(await s.movements(req.inventoryUser, req.body))
  })));
  app.post('/api/equipment/movements/:id/retry', wrap(async (req, res) => {
    const [[m]] = await db.query('SELECT * FROM inventory_movements WHERE id=?', [integer(req.params.id, 'Movement ID', 1)]);
    if (!m) throw err('Movement not found', 404);
    await s.access(req.inventoryUser, m.school_id, true);
    if (m.status !== 'needs_review') throw err('Only an approved missing report needing a stock check can be retried', 409);
    await s.reconcileOne(m.id, true);
    res.json({
      success: true
    });
  }));
  app.get('/api/school-inventory/schools', wrap(async (req, res) => {
    const ids = await s.schoolIds(req.inventoryUser);
    const [schools] = await db.query('SELECT id,name,city,school_code FROM schools' + (ids ? ' WHERE id IN (?)' : '') + ' ORDER BY name', ids ? [ids.length ? ids : [0]] : []);
    res.json({
      success: true,
      schools
    });
  }));
  app.get('/api/school-inventory/:schoolId/years', wrap(async (req, res) => {
    await s.access(req.inventoryUser, sid(req));
    const [years] = await db.query('SELECT DISTINCT `year` FROM school_inventory_equipments WHERE school_id=? ORDER BY `year` DESC', [sid(req)]);
    res.json({
      success: true,
      years: years.map(r => r.year)
    });
  }));
  app.get('/api/school-inventory/:schoolId', wrap(async (req, res) => {
    const school = await s.access(req.inventoryUser, sid(req));
    let sql = 'SELECT * FROM school_inventory_equipments WHERE school_id=?',
      params = [school.id];
    if (req.query.month) {
      sql += ' AND `month`=?';
      params.push(req.query.month);
    }
    if (req.query.year) {
      sql += ' AND `year`=?';
      params.push(req.query.year);
    }
    const [equipments] = await db.query(sql + ' ORDER BY equipment_name', params);
    if (equipments.length) {
      const [variants] = await db.query('SELECT * FROM school_inventory_equipment_variants WHERE equipment_id IN (?) ORDER BY id', [equipments.map(e => e.id)]);
      for (const e of equipments) e.variants = variants.filter(v => v.equipment_id === e.id);
    }
    res.json({
      success: true,
      school,
      equipments
    });
  }));
  function variant(v) {
    const quantity = integer(v.quantity, 'Physical count'),
      damaged = integer(v.damaged || 0, 'Damaged count');
    if (damaged > quantity) throw err('Damaged cannot exceed the physical count');
    const size = String(v.size || '').trim();
    if (size.length > 50) throw err('Size is too long');
    const condition = String(v.condition || 'Good');
    if (!['Good', 'Attention', 'Replace/Repair'].includes(condition)) throw err('Invalid condition');
    return {
      id: v.id ? integer(v.id, 'Variant ID', 1) : null,
      size: size || null,
      quantity,
      damaged,
      condition
    };
  }
  function equipment(body, old = {}) {
    const name = String(body.equipment_name ?? old.equipment_name ?? '').trim(),
      month = body.month ?? old.month,
      year = integer(body.year ?? old.year, 'Year', 2000);
    if (!name || name.length > 255 || !s.MONTHS.includes(month) || year > 2100) throw err('Choose a valid item, month and year');
    let variants;
    if (body.variants !== undefined) {
      if (!Array.isArray(body.variants) || !body.variants.length || body.variants.length > 100) throw err('Add between 1 and 100 sizes');
      variants = body.variants.map(variant);
      const seen = new Set();
      for (const v of variants) {
        const k = String(v.size || '').toLowerCase();
        if (seen.has(k)) throw err('Each size may appear only once');
        seen.add(k);
      }
    }
    return {
      name,
      month,
      year,
      variants
    };
  }
  async function getEquipment(req) {
    const [[e]] = await db.query('SELECT * FROM school_inventory_equipments WHERE id=?', [integer(req.params.equipmentId, 'Equipment ID', 1)]);
    if (!e) throw err('Equipment not found', 404);
    await s.access(req.inventoryUser, e.school_id, true);
    return e;
  }
  async function lockEquipment(c, e) {
    const [[fresh]] = await c.query('SELECT * FROM school_inventory_equipments WHERE id=? FOR UPDATE', [e.id]);
    if (!fresh) throw err('Equipment was removed. Refresh stock and try again.', 404);
    if (Number(fresh.school_id) !== Number(e.school_id)) throw err('School changed. Refresh stock and try again.', 409);
    return fresh;
  }
  async function protectRemoval(c, ids) {
    if (!ids.length) return;
    const [[used]] = await c.query('SELECT id FROM inventory_movements WHERE variant_id IN (?) LIMIT 1', [ids]);
    if (used) throw err('This size has a movement history. Keep its row and use a zero count instead.', 409);
  }
  app.post('/api/school-inventory/:schoolId/equipments', wrap(async (req, res) => {
    const school = await s.access(req.inventoryUser, sid(req), true),
      data = equipment(req.body);
    if (!data.variants) throw err('Add at least one size');
    const equipment_id = await s.transaction(school.id, async c => {
      const [r] = await c.query('INSERT INTO school_inventory_equipments(school_id,equipment_name,`month`,`year`) VALUES(?,?,?,?)', [school.id, data.name, data.month, data.year]);
      for (const v of data.variants) await c.query('INSERT INTO school_inventory_equipment_variants(equipment_id,size,quantity,damaged,`condition`) VALUES(?,?,?,?,?)', [r.insertId, v.size, v.quantity, v.damaged, v.condition]);
      return r.insertId;
    });
    res.json({
      success: true,
      equipment_id
    });
  }));
  app.put('/api/school-inventory/equipment/:equipmentId', wrap(async (req, res) => {
    const e = await getEquipment(req);
    await s.transaction(e.school_id, async c => {
      const fresh = await lockEquipment(c, e);
      const d = equipment(req.body, fresh);
      const [old] = await c.query('SELECT * FROM school_inventory_equipment_variants WHERE equipment_id=? FOR UPDATE', [e.id]);
      if (d.variants) {
        const ids = d.variants.filter(v => v.id).map(v => v.id);
        if (new Set(ids).size !== ids.length || ids.some(id => !old.some(v => v.id === id))) throw err('Invalid variant ID');
        const removed = old.filter(v => !ids.includes(v.id)).map(v => v.id);
        await protectRemoval(c, removed);
        for (const v of d.variants) {
          if (v.id) await c.query('UPDATE school_inventory_equipment_variants SET size=?,quantity=?,damaged=?,`condition`=? WHERE id=? AND equipment_id=?', [v.size, v.quantity, v.damaged, v.condition, v.id, e.id]);else await c.query('INSERT INTO school_inventory_equipment_variants(equipment_id,size,quantity,damaged,`condition`) VALUES(?,?,?,?,?)', [e.id, v.size, v.quantity, v.damaged, v.condition]);
        }
        if (removed.length) await c.query('DELETE FROM school_inventory_equipment_variants WHERE id IN (?)', [removed]);
      }
      await c.query('UPDATE school_inventory_equipments SET equipment_name=?,`month`=?,`year`=? WHERE id=?', [d.name, d.month, d.year, e.id]);
    });
    res.json({
      success: true,
      equipment_id: e.id
    });
  }));
  app.post('/api/school-inventory/equipment/:equipmentId/variants', wrap(async (req, res) => {
    const e = await getEquipment(req);
    const input = req.body.variants === undefined ? [req.body] : req.body.variants;
    if (!Array.isArray(input) || !input.length || input.length > 100) throw err('Add between 1 and 100 sizes');
    const variants = input.map(variant);
    const variant_ids = await s.transaction(e.school_id, async c => {
      await lockEquipment(c, e);
      const added = [];
      for (const v of variants) {
        const [[dupe]] = await c.query("SELECT id FROM school_inventory_equipment_variants WHERE equipment_id=? AND TRIM(COALESCE(size,''))=?", [e.id, v.size || '']);
        if (dupe) throw err('This size already exists', 409);
        const [r] = await c.query('INSERT INTO school_inventory_equipment_variants(equipment_id,size,quantity,damaged,`condition`) VALUES(?,?,?,?,?)', [e.id, v.size, v.quantity, v.damaged, v.condition]);
        added.push(r.insertId);
      }
      return added;
    });
    res.json({
      success: true,
      variant_id: variant_ids[0],
      variant_ids
    });
  }));
  app.delete('/api/school-inventory/variant/:variantId', wrap(async (req, res) => {
    const [[v]] = await db.query('SELECT v.*,e.school_id FROM school_inventory_equipment_variants v JOIN school_inventory_equipments e ON e.id=v.equipment_id WHERE v.id=?', [integer(req.params.variantId, 'Variant ID', 1)]);
    if (!v) throw err('Size not found', 404);
    await s.access(req.inventoryUser, v.school_id, true);
    await s.transaction(v.school_id, async c => {
      await protectRemoval(c, [v.id]);
      await c.query('DELETE FROM school_inventory_equipment_variants WHERE id=?', [v.id]);
    });
    res.json({
      success: true
    });
  }));
  app.delete('/api/school-inventory/equipment/:equipmentId', wrap(async (req, res) => {
    const e = await getEquipment(req);
    await s.transaction(e.school_id, async c => {
      const [v] = await c.query('SELECT id FROM school_inventory_equipment_variants WHERE equipment_id=?', [e.id]);
      await protectRemoval(c, v.map(r => r.id));
      await c.query('DELETE FROM school_inventory_equipment_variants WHERE equipment_id=?', [e.id]);
      await c.query('DELETE FROM school_inventory_equipments WHERE id=?', [e.id]);
    });
    res.json({
      success: true
    });
  }));
  app.get('/api/equipment-orders', wrap(async (req, res) => {
    const ids = await s.schoolIds(req.inventoryUser),
      params = [];
    let where = ' WHERE 1=1';
    if (ids) {
      where += ' AND eo.school_id IN (?)';
      params.push(ids.length ? ids : [0]);
    }
    if (!s.admin(req.inventoryUser) && Number(req.inventoryUser.role_id) !== 3) {
      where += ' AND eo.user_id=?';
      params.push(req.inventoryUser.id);
    }
    if (req.query.school_id) {
      await s.access(req.inventoryUser, sid(req));
      where += ' AND eo.school_id=?';
      params.push(sid(req));
    }
    const [orders] = await db.query(`SELECT eo.*,sc.name school_name,u.name user_name,m.id missing_movement_id,m.status missing_status,COALESCE(receipts.received_qty,0) received_qty FROM equipment_order eo LEFT JOIN schools sc ON sc.id=eo.school_id LEFT JOIN users u ON u.id=eo.user_id LEFT JOIN inventory_movements m ON m.linked_order_id=eo.id AND m.movement_type='missing' LEFT JOIN (SELECT linked_order_id,SUM(quantity) received_qty FROM inventory_movements WHERE movement_type='receipt' AND status='posted' GROUP BY linked_order_id) receipts ON receipts.linked_order_id=eo.id ${where} ORDER BY eo.created_at DESC,eo.id DESC`, params);
    for (const o of orders) {
      o.received_qty = Number(o.received_qty);
      o.remaining_qty = Math.max(0, o.qty - Number(o.received_qty));
      o.status = o.approve_ssgm === 0 || o.approve_admin === 0 ? 'Rejected' : o.missing_movement_id ? o.missing_status === 'posted' ? 'Missing confirmed' : o.missing_status === 'needs_review' ? 'Needs stock check' : 'Awaiting approval' : o.qty > 0 && o.received_qty >= o.qty ? 'Received' : o.approve_admin === 1 && o.approve_ssgm === 1 ? 'Admin approved' : o.approve_ssgm === 1 ? 'SSGM checked' : 'Requested';
      o.delivery_label = o.status_delivery === 1 ? 'Marked delivered on web' : null;
    }
    res.json({
      success: true,
      orders
    });
  }));
  app.post('/api/equipment-orders', multipart, wrap(async (req, res) => {
    const school = await s.access(req.inventoryUser, sid(req), true);
    let items;
    try {
      items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items || [];
    } catch {
      throw err('Invalid requested items');
    }
    if (!Array.isArray(items) || items.length > 100) throw err('Invalid requested items');
    items = items.map(i => ({
      sku_name: String(i.sku_name || '').trim(),
      qty: integer(i.qty, 'Quantity', 1),
      size: String(i.size || '').trim()
    }));
    if (items.some(i => !i.sku_name || i.sku_name.length > 255 || i.size.length > 50)) throw err('Enter an item name and a valid size');
    const f = req.file;
    if (!items.length && !f) throw err('Add at least one item or a photo');
    let ext = null;
    if (f) {
      const b = f.buffer;
      ext = b[0] === 255 && b[1] === 216 ? 'jpg' : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
      if (!ext) throw err('Invalid image content');
    }
    const idKey = String(req.body.idempotency_key || crypto.randomUUID());
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(idKey)) throw err('Invalid retry key');
    const fingerprint = s.hash({
      items,
      image: f ? crypto.createHash('sha256').update(f.buffer).digest('hex') : null
    });
    let createdFile = null;
    try {
      const result = await s.transaction(school.id, async c => {
        const [[old]] = await c.query('SELECT * FROM inventory_request_batches WHERE school_id=? AND idempotency_key=?', [school.id, idKey]);
        if (old) {
          if (old.request_hash !== fingerprint) throw err('This retry key was used for different request details', 409);
          return {
            order_ids: JSON.parse(old.order_ids),
            duplicate: true
          };
        }
        let imagePath = null;
        if (f) {
          const filename = `equipment_${crypto.randomUUID()}.${ext}`;
          fs.mkdirSync(UPLOADS_DIR, {
            recursive: true
          });
          createdFile = path.join(UPLOADS_DIR, filename);
          fs.writeFileSync(createdFile, f.buffer);
          imagePath = `uploads/${filename}`;
        }
        const orderIds = [];
        for (const i of items.length ? items : [{
          sku_name: 'Check Image',
          qty: 0,
          size: ''
        }]) {
          const [r] = await c.query('INSERT INTO equipment_order(sku_name,qty,school_id,size,user_id,image_path) VALUES(?,?,?,?,?,?)', [i.sku_name, i.qty, school.id, i.size, req.inventoryUser.id, imagePath]);
          orderIds.push(r.insertId);
        }
        await c.query('INSERT INTO inventory_request_batches(school_id,idempotency_key,request_hash,order_ids,user_id) VALUES(?,?,?,?,?)', [school.id, idKey, fingerprint, JSON.stringify(orderIds), req.inventoryUser.id]);
        return {
          order_ids: orderIds,
          duplicate: false
        };
      });
      res.json({
        success: true,
        message: 'Request recorded',
        ...result
      });
    } catch (e) {
      if (createdFile) try {
        fs.unlinkSync(createdFile);
      } catch {}
      throw e;
    }
  }));
  app.put('/api/equipment-orders/:id/status', wrap(async (req, res) => {
    const u = req.inventoryUser;
    if (!s.admin(u) && Number(u.role_id) !== 3) throw err('Only SSGM or Admin can approve requests', 403);
    const [[o]] = await db.query('SELECT * FROM equipment_order WHERE id=?', [integer(req.params.id, 'Order ID', 1)]);
    if (!o) throw err('Request not found', 404);
    await s.access(u, o.school_id, true);
    const status = String(req.body.status || '').toLowerCase();
    if (!['approved', 'rejected', 'delivered'].includes(status)) throw err('Choose approved, rejected or delivered');
    const date = req.body.delivery_date || null;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + 'T00:00:00Z').getTime()) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) throw err('Invalid delivery date');
    await s.transaction(o.school_id, async c => {
      const [[current]] = await c.query('SELECT * FROM equipment_order WHERE id=? FOR UPDATE', [o.id]);
      if (!current) throw err('Request was removed. Refresh and try again.', 404);
      const [[loss]] = await c.query("SELECT * FROM inventory_movements WHERE linked_order_id=? AND movement_type='missing'", [o.id]);
      if (loss?.status === 'posted') throw err('This missing report has already been applied', 409);
      if (Number(u.role_id) === 3) {
        if (status === 'delivered') throw err('Only Admin marks delivery', 403);
        if (current.approve_admin !== null) throw err('Admin has already reviewed this request', 409);
        await c.query('UPDATE equipment_order SET approve_ssgm=? WHERE id=?', [status === 'approved' ? 1 : 0, o.id]);
      } else {
        if (current.approve_ssgm !== 1) throw err('SSGM must check the request first', 409);
        if (status === 'delivered') {
          if (loss) throw err('Missing reports are not deliveries');
          if (current.approve_admin !== 1) throw err('Approve before delivery', 409);
          await c.query('UPDATE equipment_order SET status_delivery=1 WHERE id=?', [o.id]);
        } else await c.query('UPDATE equipment_order SET approve_admin=?,status_delivery=0,delivery_date=? WHERE id=?', [status === 'approved' ? 1 : 0, date, o.id]);
      }
    });
    const [[loss]] = await db.query("SELECT id FROM inventory_movements WHERE linked_order_id=? AND movement_type='missing'", [o.id]);
    if (loss) await s.reconcileOne(loss.id);
    res.json({
      success: true
    });
  }));
  // Web :3000 shares order flags, but does not know the ledger. Apply approved losses exactly once.
  s.migrate().then(() => s.reconcile()).catch(e => console.error('Inventory setup:', e.message));
  const timer = setInterval(() => s.reconcile().catch(e => console.error('Inventory reconciliation:', e.message)), 15000);
  timer.unref();
  return s;
};
