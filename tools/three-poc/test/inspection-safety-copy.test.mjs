// The 3D guide and the phone must ask for the same thing: look, do not touch. The phone's rule: "부품을 만지거나 캡·덮개를 열지 마세요".
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LIGHT_SCOPE_TEXT,washerGuideHtml} from '../inspection-product.mjs';
import {MOBILE_TARGETS,validateMobileResult} from '../mobile-result-contract.mjs';

const html=washerGuideHtml('https://manual.invalid/');
const text=html.replace(/<[^>]+>/g,' ');

test('the washer guide asks to look without touching, and never to open or refill',()=>{
  assert.match(text,/부품을 만지거나 캡·덮개를 열지 마세요/);
  assert.match(text,/직접 보충하지 마세요/);
  assert.match(text,/겉으로 보이는 모습만 눈으로 확인합니다/);
  for(const instruction of [/캡을 열어/,/보충하고/,/캡을 닫/,/양을 확인합니다/])assert.doesNotMatch(text,instruction);
});

test('the guide keeps the safe parking, power and cooling steps of the phone flow',()=>{
  assert.match(text,/평탄하고 안전한 곳에 세우고 P·주차 브레이크를 확인합니다/);
  assert.match(text,/전원을 끄고, 충전 중이 아닌지 확인합니다/);
  assert.match(text,/보닛을 단단히 고정하고 모터룸이 완전히 식은 뒤에 살펴봅니다/);
});

test('a later refill goes to the manual or the manufacturer, and the fluid warning stays',()=>{
  assert.match(text,/사용설명서나 제조사 서비스 안내를 따르세요/);
  assert.match(text,/냉각수나 부동액을 워셔액 대신 쓰지 않습니다/);
  assert.match(text,/위치와 형상은 추정입니다/);
});

test('the manual link stays, and says the refill procedure is outside this inspection',()=>{
  assert.match(html,/href="https:\/\/manual\.invalid\/"/);
  assert.match(html,/rel="noopener noreferrer"/);
  assert.match(text,/보충 절차는 이 점검에 포함되지 않습니다/);
});

test('the page shows this guide and no longer holds the old instruction anywhere',()=>{
  const page=readFileSync(new URL('../inspect.js',import.meta.url),'utf8');
  assert.match(page,/washerGuideHtml\(esc\(SERVICE_MANUAL\)\)/);
  for(const old of ['캡을 열어 워셔액 양을','보충하고 캡을 닫습니다'])assert.ok(!page.includes(old),old);
});

test('a light name stays short, and the text says only the exterior is checked',()=>{
  assert.match(LIGHT_SCOPE_TEXT,/겉모습만 눈으로 확인/);
  assert.match(LIGHT_SCOPE_TEXT,/켜서 시험하거나 만지거나 분해하지 마세요/);
  const page=readFileSync(new URL('../inspect.js',import.meta.url),'utf8');
  assert.equal(page.match(/LIGHT_SCOPE_TEXT/g).length,3,'imported once, shown on the detail and the result screen');
  for(const light of MOBILE_TARGETS.filter(t=>t.area==='lights'))assert.doesNotMatch(light.label,/외관/);
});

test('the result contract is untouched: the washer still reports the same three answers',()=>{
  const washer=MOBILE_TARGETS[0];
  assert.deepEqual({taskId:washer.taskId,partId:washer.partId,schemaVersion:washer.schemaVersion,responseKeys:[...washer.responseKeys]},{taskId:'washer-fluid',partId:'washer-fluid-cap',schemaVersion:1,responseKeys:[]});
  const contract=readFileSync(new URL('../mobile-result-contract.mjs',import.meta.url),'utf8');
  assert.match(contract,/OK:'NO_FINDINGS_REPORTED',NEEDS_REFILL:'FINDINGS_REPORTED',UNSURE:'UNABLE'/);
  assert.equal(typeof validateMobileResult,'function');
});
