// Local-only integration test: real head coach 938 on :4000; temporary named items only.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  assert = require('assert/strict');
const db = require('../db'),
  service = require('../services/inventoryService')(db);
const base = 'http://127.0.0.1:4000',
  prefix = 'MQ_EQ_TEST_' + crypto.randomUUID().slice(0, 8),
  school = 2;
let bearer,
  refresh,
  passes = 0,
  lockExisted = false;
const createdOrders = new Set(),
  createdFiles = new Set();
const check = (ok, label) => {
  assert.ok(ok, label);
  console.log('PASS', ++passes, label);
};
async function call(url, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + url, {
    method,
    headers: {
      ...(bearer ? {
        Authorization: 'Bearer ' + bearer
      } : {}),
      ...(body instanceof FormData ? {} : {
        'Content-Type': 'application/json'
      })
    },
    ...(body ? {
      body: body instanceof FormData ? body : JSON.stringify(body)
    } : {})
  });
  return {
    status: r.status,
    ...(await r.json().catch(() => ({})))
  };
}
const fresh = () => crypto.randomUUID();
async function move(type, quantity, extra = {}, id = fresh()) {
  const body = {
    school_id: school,
    movement_type: type,
    equipment_name: prefix,
    size: '5',
    quantity,
    idempotency_key: id,
    ...extra
  };
  return {
    body,
    result: await call('/api/equipment/movements', body)
  };
}
async function stock() {
  const x = await call('/api/equipment/current?school_id=2');
  assert.equal(x.status, 200, x.message);
  return x.stock.find(r => r.equipment_name === prefix && r.size === '5');
}
async function expectCount(q, d, label) {
  const r = await stock();
  check(r.quantity === q && r.damaged === d && r.usable === q - d, label);
  return r;
}
async function approveTestOrder(id) {
  assert.ok(createdOrders.has(id), 'Only this run\'s order may be simulated');
  await db.query('UPDATE equipment_order SET approve_ssgm=1,approve_admin=1,status_delivery=0 WHERE id=? AND user_id=938', [id]);
}
(async () => {
  try {
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      try {
        healthy = (await fetch(base + '/health')).ok;
      } catch {}
      if (healthy) break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(healthy, 'API 4000 must be healthy');
    await service.migrate();
    const [locks] = await db.query('SELECT school_id FROM inventory_school_locks WHERE school_id=?', [school]);
    lockExisted = locks.length > 0;
    const fixture = fs.readFileSync(process.env.MQ_HEADCOACH_FIXTURE || path.join(process.env.USERPROFILE, 'Desktop/mq-test-headcoach-login.txt'), 'utf8');
    const email = fixture.match(/^Email:\s*(.+)$/mi)?.[1].trim(),
      password = fixture.match(/^Password:\s*(.+)$/mi)?.[1].trim();
    assert.ok(email && password, 'Fixture format');
    let x = await call('/api/login', {
      email,
      password
    });
    check(x.success && x.user.id === 938 && Number(x.user.role_id) === 4, 'real 938 / role 4 login on 4000');
    bearer = x.token;
    refresh = x.refresh_token;
    x = await call('/api/school-inventory/schools');
    check(x.schools.length > 0 && x.schools.every(s => Number(s.id) === 2), 'JWT-scoped school picker');
    const baseline = await call('/api/equipment/current?school_id=2');
    check(baseline.success && Array.isArray(baseline.stock), 'current stock endpoint and explicit not-counted state');
    x = await call('/api/equipment/current?school_id=1&role_id=1&user_id=1');
    check(x.status === 403, 'spoofed role cannot read another school');
    x = await call('/api/equipment/movements', {
      school_id: 1,
      movement_type: 'receipt',
      equipment_name: prefix,
      quantity: 1,
      idempotency_key: fresh()
    });
    check(x.status === 403, 'cross-school movement denied');
    const p = service.period(),
      prev = n => {
        const date = new Date(Date.UTC(p.year, p.number - 1 - n, 1));
        return {
          month: service.MONTHS[date.getUTCMonth()],
          year: date.getUTCFullYear()
        };
      };
    const older = prev(2),
      newer = prev(1);
    x = await call('/api/school-inventory/2/equipments', {
      equipment_name: prefix,
      ...older,
      variants: [{
        size: '5',
        quantity: 10,
        damaged: 1
      }, {
        size: '6',
        quantity: 7,
        damaged: 0
      }]
    });
    check(x.success, 'compatible equipment create with two sizes');
    x = await call('/api/school-inventory/2/equipments', {
      equipment_name: prefix,
      ...newer,
      variants: [{
        size: '5',
        quantity: 20,
        damaged: 2
      }]
    });
    check(x.success, 'second monthly snapshot');
    await expectCount(20, 2, 'current count is latest 20, not monthly sum 30');
    let m = await move('receipt', 5);
    check(m.result.success, 'head coach confirms receipt directly');
    const current = await expectCount(25, 2, 'receipt adds quantity and carries damaged count');
    x = await call('/api/equipment/current?school_id=2');
    check(x.stock.find(r => r.equipment_name === prefix && r.size === '6')?.quantity === 7, 'new month copies latest record independently for every size');
    const [historic] = await db.query('SELECT v.quantity FROM school_inventory_equipments e JOIN school_inventory_equipment_variants v ON v.equipment_id=e.id WHERE e.school_id=? AND e.equipment_name=? AND e.`month`=? AND e.`year`=? AND v.size=?', [school, prefix, newer.month, newer.year, '5']);
    check(historic[0].quantity === 20, 'previous month is unchanged');
    const replay = await call('/api/equipment/movements', m.body);
    check(replay.success && replay.duplicate && replay.movement.id === m.result.movement.id, 'retry returns same movement exactly once');
    await expectCount(25, 2, 'retry does not add stock twice');
    x = await call('/api/equipment/movements', {
      ...m.body,
      quantity: 6
    });
    check(x.status === 409, 'same key with different quantity rejected');
    x = await call('/api/equipment/recipients?school_id=2');
    check(Array.isArray(x.students) && Array.isArray(x.teams) && x.coaches.some(c => c.id === 938), 'student, team and coach picker options');
    m = await move('issue', 3, {
      recipient_type: 'coach',
      recipient_id: 938,
      user_id: 1
    });
    check(m.result.success && m.result.movement.user_id === 938 && m.result.movement.recipient_name, 'issue uses authenticated author and real school recipient');
    const issue = m.result.movement.id;
    await expectCount(22, 2, 'give out reduces school physical stock');
    m = await move('return', 2, {
      linked_issue_id: issue,
      returned_damaged: 1,
      equipment_name: 'IGNORED',
      size: 'IGNORED'
    });
    check(m.result.success && m.result.movement.equipment_name === prefix, 'return derives item and borrower from original loan');
    await expectCount(24, 3, 'damaged return increases both physical and damaged count');
    x = await call('/api/equipment/loans?school_id=2');
    check(x.loans.find(l => l.id === issue)?.outstanding === 1, 'partial return leaves one outstanding');
    m = await move('return', 2, {
      linked_issue_id: issue
    });
    check(m.result.status === 409, 'over-return blocked');
    m = await move('return', 1, {
      linked_issue_id: issue
    });
    check(m.result.success, 'remaining loan returned');
    m = await move('damage', 4);
    check(m.result.success, 'damage confirmed by head coach without approval');
    await expectCount(25, 7, 'damage leaves total unchanged and reduces usable');
    m = await move('missing', 3, {
      note: 'temporary approval test'
    });
    check(m.result.success && m.result.movement.status === 'pending', 'missing creates pending SSGM/Admin approval');
    const loss = m.result.movement;
    createdOrders.add(loss.linked_order_id);
    await expectCount(25, 7, 'pending missing does not deduct stock');
    x = await call(`/api/equipment-orders/${loss.linked_order_id}/status`, {
      status: 'approved',
      role_id: 1
    }, 'PUT');
    check(x.status === 403, '938 cannot spoof Admin approval');
    await approveTestOrder(loss.linked_order_id);
    await service.reconcileOne(loss.id);
    await expectCount(22, 7, 'web-style SSGM/Admin flags reconcile approved missing');
    await service.reconcileOne(loss.id);
    await expectCount(22, 7, 'approval reconciliation is duplicate safe');
    m = await move('missing', 10);
    check(m.result.success, 'second missing report waits for approval');
    const blockedLoss = m.result.movement;
    createdOrders.add(blockedLoss.linked_order_id);
    m = await move('issue', 10, {
      recipient_type: 'coach',
      recipient_id: 938
    });
    check(m.result.success, 'new loan before missing approval');
    const secondIssue = m.result.movement.id;
    await approveTestOrder(blockedLoss.linked_order_id);
    await service.reconcileOne(blockedLoss.id);
    const [[needs]] = await db.query('SELECT status FROM inventory_movements WHERE id=?', [blockedLoss.id]);
    check(needs.status === 'needs_review', 'insufficient stock on final approval needs review, never negative');
    await expectCount(12, 7, 'failed approval does not change stock');
    await move('return', 10, {
      linked_issue_id: secondIssue
    });
    x = await call(`/api/equipment/movements/${blockedLoss.id}/retry`, {});
    check(x.success, 'head coach can recheck previously approved missing');
    await expectCount(12, 7, 'recheck applies approved missing once after return');
    let reqBody = {
      school_id: school,
      idempotency_key: fresh(),
      items: [{
        sku_name: prefix,
        qty: 6,
        size: '5'
      }]
    };
    x = await call('/api/equipment-orders', reqBody);
    check(x.success && x.order_ids.length === 1, 'purchase request uses shared equipment_order');
    const order = x.order_ids[0];
    createdOrders.add(order);
    const duplicate = await call('/api/equipment-orders', reqBody);
    check(duplicate.duplicate && duplicate.order_ids[0] === order, 'request retries do not duplicate rows');
    m = await move('receipt', 2, {
      linked_order_id: order
    });
    check(m.result.status === 409, 'cannot receive an unapproved request');
    await approveTestOrder(order);
    m = await move('receipt', 2, {
      linked_order_id: order
    });
    check(m.result.success, 'partial approved request receipt');
    await expectCount(14, 7, 'approved receipt updates shared snapshot');
    m = await move('receipt', 5, {
      linked_order_id: order
    });
    check(m.result.status === 409, 'cannot receive more than remaining request');
    m = await move('receipt', 4, {
      linked_order_id: order
    });
    check(m.result.success, 'remaining requested items received');
    await expectCount(18, 7, 'full receipt count correct');
    x = await call('/api/equipment-orders?school_id=2');
    const received = x.orders.find(o => o.id === order);
    check(received.received_qty === 6 && received.status === 'Received' && received.status_delivery === 1, 'timeline reaches Received only on real stock receipt');
    const outcomes = await Promise.all([move('issue', 6, {
      recipient_type: 'coach',
      recipient_id: 938
    }), move('issue', 6, {
      recipient_type: 'coach',
      recipient_id: 938
    })]);
    check(outcomes.filter(o => o.result.success).length === 1 && outcomes.filter(o => o.result.status === 409).length === 1, 'concurrent competing issues cannot oversell');
    await move('return', 6, {
      linked_issue_id: outcomes.find(o => o.result.success).result.movement.id
    });
    const sameKey = fresh(),
      parallel = await Promise.all(Array.from({
        length: 5
      }, () => move('receipt', 1, {}, sameKey)));
    check(parallel.every(p => p.result.success) && new Set(parallel.map(p => p.result.movement.id)).size === 1, 'five concurrent identical retries produce one movement');
    await expectCount(19, 7, 'parallel retry quantity only applied once');
    m = await move('issue', 2, {
      recipient_type: 'coach',
      recipient_id: 938
    });
    check(m.result.success, 'loan for missing-loan approval test');
    const lostIssue = m.result.movement.id;
    await expectCount(17, 7, 'loan removes physical items once');
    m = await move('missing', 2, {
      linked_issue_id: lostIssue
    });
    check(m.result.success, 'missing items can be linked to an outstanding loan');
    const missingLoan = m.result.movement;
    createdOrders.add(missingLoan.linked_order_id);
    await approveTestOrder(missingLoan.linked_order_id);
    await service.reconcileOne(missingLoan.id);
    await expectCount(17, 7, 'missing loan does not double deduct school stock');
    x = await call('/api/equipment/loans?school_id=2');
    check(!x.loans.some(l => l.id === lostIssue), 'approved missing loan is closed');
    m = await move('return', 1, {
      linked_issue_id: lostIssue
    });
    check(m.result.status === 409, 'cannot return an item already confirmed missing');
    m = await move('missing', 1);
    check(m.result.success, 'rejection test report created');
    const rejected = m.result.movement;
    createdOrders.add(rejected.linked_order_id);
    await db.query('UPDATE equipment_order SET approve_ssgm=0 WHERE id=? AND user_id=938', [rejected.linked_order_id]);
    await service.reconcileOne(rejected.id);
    const [[rejectedRow]] = await db.query('SELECT status FROM inventory_movements WHERE id=?', [rejected.id]);
    check(rejectedRow.status === 'rejected', 'SSGM rejection leaves stock unchanged');
    await expectCount(17, 7, 'rejected missing does not deduct');
    m = await move('damage', 13);
    check(m.result.status === 409, 'damage cannot exceed usable count');
    m = await move('receipt', -1);
    check(m.result.status === 400, 'negative quantities rejected');
    m = await move('issue', 1, {
      recipient_type: 'coach',
      recipient_id: 1
    });
    check(m.result.status === 400, 'foreign recipient rejected');
    x = await call('/api/school-inventory/2?month=' + p.month + '&year=' + p.year);
    const equipment = x.equipments.find(e => e.equipment_name === prefix);
    const ids = equipment.variants.map(v => v.id).sort();
    x = await call(`/api/school-inventory/equipment/${equipment.id}`, {
      equipment_name: prefix,
      month: p.month,
      year: p.year,
      variants: equipment.variants
    }, 'PUT');
    check(x.success, 'compatible edit with existing variant IDs');
    x = await call('/api/school-inventory/2?month=' + p.month + '&year=' + p.year);
    check(JSON.stringify(x.equipments.find(e => e.id === equipment.id).variants.map(v => v.id).sort()) === JSON.stringify(ids), 'variant IDs preserved during edits');
    x = await call(`/api/school-inventory/equipment/${equipment.id}`, {
      equipment_name: prefix
    }, 'PUT');
    check(x.success, 'partial equipment edit does not silently delete sizes');
    x = await call(`/api/school-inventory/equipment/${equipment.id}/variants`, {
      variants: [{
        size: 'XL',
        quantity: 0,
        damaged: 0
      }, {
        size: 'XXL',
        quantity: 1,
        damaged: 0
      }]
    });
    check(x.success && x.variant_ids.length === 2, 'web-compatible bulk add sizes');
    const variantIds = x.variant_ids;
    x = await call('/api/school-inventory/variant/' + variantIds[0], null, 'DELETE');
    check(x.success, 'delete unreferenced test size');
    x = await call('/api/school-inventory/variant/' + current.variant_id, null, 'DELETE');
    check(x.status === 409, 'ledger-linked variant is protected from deletion');
    const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'),
      form = new FormData();
    form.append('school_id', '2');
    form.append('idempotency_key', fresh());
    form.append('items', JSON.stringify([{
      sku_name: prefix + '_PHOTO',
      qty: 1,
      size: ''
    }]));
    form.append('image', new Blob([photo], {
      type: 'image/png'
    }), 'test.png');
    x = await call('/api/equipment-orders', form);
    check(x.success, 'photo upload through multipart/XHR-compatible request');
    for (const id of x.order_ids || []) createdOrders.add(id);
    const [photoRows] = await db.query('SELECT image_path FROM equipment_order WHERE id IN (?)', [x.order_ids]);
    for (const r of photoRows) {
      createdFiles.add(r.image_path);
      const img = await fetch(base + '/' + r.image_path);
      check(img.status === 200, 'request image is accessible through shared uploads');
    }
    x = await call('/api/equipment/movements?school_id=2');
    check(x.movements.some(m => m.equipment_name === prefix) && x.movements.every(m => m.school_id === 2), 'scoped movement activity');
    const anonymous = await fetch(base + '/api/equipment/current?school_id=2');
    check(anonymous.status === 401, 'inventory is not public');
    console.log('ALL EQUIPMENT CHECKS PASSED', passes);
  } finally {
    // Prefix is random for this run; never touch pre-existing inventory, orders or uploads.
    const [lossOrders] = await db.query("SELECT linked_order_id FROM inventory_movements WHERE school_id=? AND equipment_name=? AND movement_type='missing'", [school, prefix]);
    for (const r of lossOrders) createdOrders.add(r.linked_order_id);
    await db.query('DELETE FROM inventory_movements WHERE school_id=? AND equipment_name=? AND user_id=938', [school, prefix]);
    const [batches] = await db.query('SELECT id,order_ids FROM inventory_request_batches WHERE school_id=? AND user_id=938', [school]);
    for (const b of batches) {
      const ids = JSON.parse(b.order_ids);
      if (ids.some(id => createdOrders.has(id))) await db.query('DELETE FROM inventory_request_batches WHERE id=?', [b.id]);
    }
    if (createdOrders.size) {
      const [files] = await db.query('SELECT image_path FROM equipment_order WHERE id IN (?) AND user_id=938', [[...createdOrders]]);
      for (const r of files) if (r.image_path) createdFiles.add(r.image_path);
      await db.query('DELETE FROM equipment_order WHERE id IN (?) AND user_id=938', [[...createdOrders]]);
    }
    await db.query('DELETE v FROM school_inventory_equipment_variants v JOIN school_inventory_equipments e ON e.id=v.equipment_id WHERE e.school_id=? AND e.equipment_name=?', [school, prefix]);
    await db.query('DELETE FROM school_inventory_equipments WHERE school_id=? AND equipment_name=?', [school, prefix]);
    for (const f of createdFiles) if (/^uploads\/equipment_[a-f0-9-]+\.png$/.test(f)) try {
      fs.unlinkSync(path.join(process.env.UPLOADS_DIR, path.basename(f)));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (!lockExisted) {
      const [[remaining]] = await db.query('SELECT COUNT(*) n FROM inventory_movements WHERE school_id=?', [school]);
      if (!remaining.n) await db.query('DELETE FROM inventory_school_locks WHERE school_id=?', [school]);
    }
    const [[left]] = await db.query('SELECT COUNT(*) n FROM school_inventory_equipments WHERE school_id=? AND equipment_name=?', [school, prefix]);
    check(left.n === 0, 'own test inventory rows cleaned up');
    if (bearer && refresh) await call('/api/logout', {
      refresh_token: refresh
    }).catch(() => {});
    await db.end();
  }
})().catch(e => {
  console.error('TEST FAILED:', e.message);
  process.exitCode = 1;
});
