// Node smoke test for JSX syntax, navigation wiring and live light/dark styles.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const babel=require('@babel/core');
const parser=require('@babel/parser');
function load(file,imports){const source=fs.readFileSync(file,'utf8');const code=babel.transformSync(source,{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-react-jsx','@babel/plugin-transform-modules-commonjs']}).code;const mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,require:n=>{if(n in imports)return imports[n];throw new Error('Unexpected import '+n);},console},{filename:file});return mod.exports;}
const react=require('react');
const theme=load('src/theme/colors.js',{'react-native':{StyleSheet:{create:s=>s}}});
const c=load('src/components/matchReports.js',{'react':react,'react-native':{},'@expo/vector-icons':{},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0})},'../theme/colors':theme,'../api':{}});
for(const mode of ['light','dark']){theme.applyPalette(mode);assert.equal(c.ms.screen.backgroundColor,theme.palettes[mode].navy);assert.equal(c.ms.card.backgroundColor,theme.palettes[mode].navyLight);assert.equal(c.ms.input.color,theme.palettes[mode].text);console.log('PASS live '+mode+' screen/card/input styles');}
const nav=fs.readFileSync('src/navigation/AppNavigator.js','utf8');for(const name of ['MatchReport','MatchReportDetail','MatchReportForm'])assert.ok(nav.includes(name+':'),'missing nested stack route '+name);console.log('PASS list/details/form in tab-preserving shared stacks');
const tiles=fs.readFileSync('src/components/MoreSheet.js','utf8');assert.equal((tiles.match(/key: 'matchreport'/g)||[]).length,1);assert.equal((tiles.match(/go: \['MatchReport'\]/g)||[]).length,1);console.log('PASS exactly one MoreSheet match tile');
for(const file of ['src/components/matchReports.js','src/screens/MatchReportScreen.js','src/screens/MatchReportDetailScreen.js','src/screens/MatchReportFormScreen.js']){parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});console.log('PASS JSX '+file);}
