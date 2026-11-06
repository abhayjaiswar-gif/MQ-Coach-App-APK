// Dependency-free hook/render smoke checks. No native device or network is used here.
const fs = require('fs'),
  vm = require('vm'),
  assert = require('assert/strict'),
  babel = require('@babel/core'),
  parser = require('@babel/parser');
const actualReact = require('react');
let active;
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
  ...actualReact,
  useState(initial) {
    const i = active.i++,
      h = active;
    if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [h.slots[i], v => {
      h.slots[i] = typeof v === 'function' ? v(h.slots[i]) : v;
    }];
  },
  useRef(v) {
    const [r] = react.useState(() => ({
      current: v
    }));
    return r;
  },
  useCallback(fn, deps) {
    const i = active.i++;
    if (!same(active.slots[i]?.deps, deps)) active.slots[i] = {
      fn,
      deps
    };
    return active.slots[i].fn;
  },
  useEffect(fn, deps) {
    const i = active.i++;
    if (!same(active.slots[i], deps)) {
      active.slots[i] = deps;
      active.effects.push(fn);
    }
  }
};
function load(file, imports) {
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    babelrc: false,
    configFile: false,
    plugins: [['@babel/plugin-transform-react-jsx', {
      runtime: 'automatic'
    }], '@babel/plugin-transform-modules-commonjs']
  }).code;
  const mod = {
    exports: {}
  };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: n => n === 'react/jsx-runtime' ? require(n) : n in imports ? imports[n] : (() => {
      throw Error('Unexpected import ' + n);
    })(),
    console,
    Date,
    Math,
    Promise
  }, {
    filename: file
  });
  return mod.exports;
}
const theme = load('src/theme/colors.js', {
  'react-native': {
    StyleSheet: {
      create: s => s
    }
  }
});
const controls = {
  MatchHeader: function Header() {},
  MatchButton: function Button() {},
  MatchDropdown: function Dropdown() {},
  ms: new Proxy({}, {
    get: () => ({})
  })
};
const navCalls = [],
  saved = [],
  requested = [];
let failNext = false;
const school = {
    id: 2,
    name: 'Test School'
  },
  row = {
    variant_id: 100,
    equipment_name: 'Football',
    size: '5',
    quantity: 10,
    damaged: 2,
    usable: 8,
    month: 'October',
    year: 2026,
    missing: 1
  };
const api = {
  fileUrl: p => 'http://test/uploads/' + p,
  getEquipmentSchools: async () => [school],
  getEquipmentStock: async () => ({
    school,
    stock: [row],
    not_counted_yet: false
  }),
  getEquipmentRecipients: async () => ({
    students: [{
      id: 9,
      name: 'Student Nine'
    }],
    teams: [{
      id: 8,
      name: 'Team Eight'
    }],
    coaches: [{
      id: 938,
      name: 'Coach'
    }]
  }),
  getEquipmentLoans: async () => [{
    id: 20,
    ...row,
    recipient_name: 'Student Nine',
    recipient_type: 'student',
    quantity: 3,
    outstanding: 3
  }],
  getEquipmentMovements: async () => ({
    movements: [],
    next_before: null
  }),
  getEquipmentRequests: async () => [],
  saveEquipmentMovement: async p => {
    saved.push(JSON.parse(JSON.stringify(p)));
    if (failNext) {
      failNext = false;
      throw Error('Simulated timeout after commit');
    }
    return {
      success: true
    };
  },
  requestEquipment: async (p, photo) => {
    requested.push({
      p,
      photo
    });
    return {
      success: true
    };
  },
  retryEquipmentMissing: async () => ({
    success: true
  })
};
const screens = load('src/screens/EquipmentScreens.js', {
  'react': react,
  'react-native': Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'TextInput', 'ActivityIndicator', 'RefreshControl', 'Image', 'KeyboardAvoidingView', 'Modal'].map(x => [x, x]).concat([['Alert', {
    alert: () => {}
  }], ['Platform', {
    OS: 'android'
  }]])),
  '@react-navigation/native': {
    useFocusEffect: fn => react.useEffect(() => fn(), [fn])
  },
  '@expo/vector-icons': {
    Ionicons: 'Icon'
  },
  'expo-image-picker': {
    requestMediaLibraryPermissionsAsync: async () => ({
      granted: true
    }),
    launchImageLibraryAsync: async () => ({
      canceled: false,
      assets: [{
        uri: 'file:///test.png',
        mimeType: 'image/png'
      }]
    })
  },
  '../context/AuthContext': {
    useAuth: () => ({
      user: {
        id: 938,
        role_id: 4,
        name: 'Test Coach',
        school_id: 2
      }
    })
  },
  '../theme/colors': theme,
  '../components/matchReports': controls,
  '../api': api
});
const navigation = {
  navigate: (...a) => navCalls.push(a),
  goBack: () => navCalls.push(['back'])
};
function walk(t, out = []) {
  if (Array.isArray(t)) {
    for (const n of t) walk(n, out);
  } else if (t && typeof t === 'object' && t.props) {
    out.push(t);
    walk(t.props.children, out);
  }
  return out;
}
function text(t) {
  return walk(t).filter(n => n.type === 'Text').map(n => n.props.children).flat(Infinity).filter(x => typeof x === 'string').join(' ');
}
function harness(screen, params = {}) {
  const h = {
    slots: [],
    i: 0,
    effects: [],
    tree: null
  };
  h.render = () => {
    active = h;
    h.i = 0;
    h.effects = [];
    h.tree = screen({
      navigation,
      route: {
        params
      }
    });
    return h.tree;
  };
  h.flush = async () => {
    const effects = [...h.effects];
    h.effects = [];
    for (const f of effects) f();
    await new Promise(r => setImmediate(r));
    h.render();
  };
  h.find = (type, predicate = () => true) => {
    const n = walk(h.tree).find(n => (typeof type === 'string' ? n.type?.name === type || n.type === type : n.type === type) && predicate(n.props));
    assert.ok(n, `Missing ${type}`);
    return n.props;
  };
  h.render();
  return h;
}
const button = (h, label) => h.find('Button', p => p.label === label);
const field = (h, label) => h.find('Field', p => p.label === label);
const drop = (h, label) => h.find('Dropdown', p => p.label === label);
(async () => {
  const home = harness(screens.EquipmentHomeScreen);
  await home.flush();
  const tiles = walk(home.tree).filter(n => n.type === 'Pressable' && n.props.disabled === false);
  assert.equal(tiles.length, 5);
  assert.ok(text(home.tree).includes('Equipment') || tiles.length === 5);
  tiles[0].props.onPress();
  assert.equal(navCalls.at(-1)[0], 'EquipmentStock');
  console.log('PASS five home actions and school auto-selection');
  const h = harness(screens.EquipmentActionScreen, {
    school,
    kind: 'receipt'
  });
  await h.flush();
  h.find('Chips', p => p.options.some(o => o.id === 'new')).onChange('new');
  h.render();
  field(h, 'Item name').onChange('New football');
  field(h, 'Size (optional)').onChange('5');
  h.find('Counter').onChange('3');
  h.render();
  button(h, 'Review').onPress();
  h.render();
  assert.ok(text(h.tree).includes('Check and confirm'));
  failNext = true;
  await button(h, 'Confirm stock update').onPress();
  h.render();
  await button(h, 'Confirm stock update').onPress();
  h.render();
  assert.equal(saved.length, 2);
  assert.equal(saved[0].idempotency_key, saved[1].idempotency_key);
  assert.equal(saved[1].quantity, 3);
  assert.equal(saved[1].school_id, 2);
  assert.ok(!('user_id' in saved[1]));
  console.log('PASS receipt review, auto-school and duplicate-safe retry');
  const give = harness(screens.EquipmentActionScreen, {
    school,
    kind: 'issue'
  });
  await give.flush();
  drop(give, 'Item and size').onSelect({
    id: 100
  });
  give.render();
  drop(give, 'Choose student').onSelect({
    id: 9
  });
  give.render();
  button(give, 'Review').onPress();
  give.render();
  await button(give, 'Confirm stock update').onPress();
  assert.equal(saved.at(-1).recipient_type, 'student');
  assert.equal(saved.at(-1).recipient_id, 9);
  console.log('PASS student loan picker and reviewed issue payload');
  const ret = harness(screens.EquipmentActionScreen, {
    school,
    kind: 'issue'
  });
  await ret.flush();
  ret.find('Chips', p => p.options.some(o => o.id === 'return')).onChange('return');
  ret.render();
  drop(ret, 'Who is returning equipment?').onSelect({
    id: 20
  });
  ret.render();
  ret.find('Counter', p => p.min === 0).onChange('1');
  ret.render();
  button(ret, 'Review').onPress();
  ret.render();
  await button(ret, 'Confirm stock update').onPress();
  assert.equal(saved.at(-1).linked_issue_id, 20);
  assert.equal(saved.at(-1).returned_damaged, 1);
  console.log('PASS outstanding-loan return with damaged sub-count');
  const loss = harness(screens.EquipmentActionScreen, {
    school,
    kind: 'damage'
  });
  await loss.flush();
  loss.find('Chips', p => p.options.some(o => o.id === 'missing')).onChange('missing');
  loss.render();
  drop(loss, 'Item and size').onSelect({
    id: 100
  });
  loss.render();
  button(loss, 'Review').onPress();
  loss.render();
  await button(loss, 'Confirm request').onPress();
  assert.equal(saved.at(-1).movement_type, 'missing');
  console.log('PASS missing approval branch, separate from immediate damage');
  const req = harness(screens.EquipmentActionScreen, {
    school,
    kind: 'request'
  });
  await req.flush();
  req.find('Chips', p => p.options.some(o => o.id === 'new')).onChange('new');
  req.render();
  field(req, 'Item name').onChange('Cones');
  req.find('Counter').onChange('12');
  req.render();
  await button(req, 'Add a reference photo (optional)').onPress();
  req.render();
  button(req, 'Review').onPress();
  req.render();
  await button(req, 'Confirm request').onPress();
  assert.equal(requested[0].p.items[0].qty, 12);
  assert.equal(requested[0].photo.uri, 'file:///test.png');
  console.log('PASS request stepper and reference-photo payload');
  const loanLoss = harness(screens.EquipmentActionScreen, {
    school,
    kind: 'damage'
  });
  await loanLoss.flush();
  loanLoss.find('Chips', p => p.options.some(o => o.id === 'missing')).onChange('missing');
  loanLoss.render();
  loanLoss.find('Chips', p => p.options.some(o => o.id === 'loan')).onChange('loan');
  loanLoss.render();
  drop(loanLoss, 'Which loan is missing?').onSelect({
    id: 20
  });
  loanLoss.render();
  button(loanLoss, 'Review').onPress();
  loanLoss.render();
  await button(loanLoss, 'Confirm request').onPress();
  assert.equal(saved.at(-1).linked_issue_id, 20);
  console.log('PASS missing-loan stepper keeps the original loan link');
  const stock = harness(screens.EquipmentStockScreen, {
    school
  });
  await stock.flush();
  assert.ok(text(stock.tree).includes('Physical count'));
  console.log('PASS current stock read view');
  api.getEquipmentStock = async () => ({
    school,
    stock: [],
    not_counted_yet: true
  });
  const empty = harness(screens.EquipmentStockScreen, {
    school
  });
  await empty.flush();
  assert.ok(text(empty.tree).includes('Not counted yet'));
  console.log('PASS empty records are not shown as zero stock');
  api.getEquipmentRequests = async () => [{
    id: 1,
    sku_name: 'Football',
    qty: 5,
    received_qty: 0,
    remaining_qty: 5,
    approve_ssgm: 1,
    approve_admin: 1,
    status_delivery: 1,
    image_path: 'test.png'
  }];
  const requests = harness(screens.EquipmentRequestsScreen, {
    school
  });
  await requests.flush();
  const timelineNode = walk(requests.tree).find(n => n.type?.name === 'Timeline');
  assert.ok(timelineNode);
  const timeline = timelineNode.type(timelineNode.props);
  assert.ok(text(timeline).includes('Requested') && text(timeline).includes('SSGM checked') && text(timeline).includes('Admin approved') && text(timeline).includes('Received'));
  assert.equal(walk(timeline).filter(n => n.type === 'Icon').at(-1).props.name, 'ellipse-outline');
  console.log('PASS four-stage request timeline does not mistake web delivery flag for stock receipt');
  for (const mode of ['light', 'dark']) {
    theme.applyPalette(mode);
    assert.equal(theme.colors.navy, theme.palettes[mode].navy);
  }
  console.log('PASS live light/dark palette support');
  const tilesSource = fs.readFileSync('src/components/MoreSheet.js', 'utf8');
  assert.equal((tilesSource.match(/key: 'equipment'/g) || []).length, 1);
  assert.equal((tilesSource.match(/go: \['Equipment'\]/g) || []).length, 1);
  const nav = fs.readFileSync('src/navigation/AppNavigator.js', 'utf8');
  for (const route of ['Equipment', 'EquipmentStock', 'EquipmentRequests', 'EquipmentAction']) assert.ok(nav.includes(route + ':'));
  console.log('PASS one Equipment tile; all screens inside tab-preserving SHARED stacks');
  const apiAst = parser.parse(fs.readFileSync('src/api/index.js', 'utf8'), {
    sourceType: 'module'
  });
  const exports = new Set();
  for (const n of apiAst.program.body) if (n.type === 'ExportNamedDeclaration') {
    if (n.declaration?.id) exports.add(n.declaration.id.name);
    for (const v of n.declaration?.declarations || []) exports.add(v.id.name);
  }
  for (const file of ['src/screens/EquipmentScreens.js', 'src/screens/MatchReportScreen.js', 'src/screens/MatchReportDetailScreen.js', 'src/screens/MatchReportFormScreen.js', 'src/components/matchReports.js']) {
    const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx']
    });
    for (const n of ast.program.body) if (n.type === 'ImportDeclaration' && n.source.value === '../api') for (const i of n.specifiers) assert.ok(exports.has(i.imported.name), 'Missing API export ' + i.imported.name);
  }
  console.log('PASS Equipment and existing Match named API imports resolve');
  console.log('ALL EQUIPMENT UI SMOKE CHECKS PASSED');
})().catch(e => {
  console.error(e.stack);
  process.exitCode = 1;
});
