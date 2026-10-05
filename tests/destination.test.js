import test from 'node:test';
import assert from 'node:assert/strict';
import {relativeOutputPath, writeUniqueFile, saveOutput, setupDestination} from '../destination.js';
import {setupZip} from '../pack-selected.js';

const error = name => Object.assign(new Error(name), {name});
function directoryFixture(name = '绘画素材') {
  const state = {permission: 'granted', requests: 0, writes: 0, failWrite: false, aborts: 0};
  function folder(name) {
    const entries = new Map();
    return {
      kind: 'directory', name, entries,
      async queryPermission() {return state.permission;},
      async requestPermission() {state.requests++; return state.permission = 'granted';},
      async getDirectoryHandle(name, {create} = {}) {
        const key = name.toLowerCase(), existing = entries.get(key);
        if (existing && existing.kind !== 'directory') throw error('TypeMismatchError');
        if (existing) return existing;
        if (!create) throw error('NotFoundError');
        const next = folder(name); entries.set(key, next); return next;
      },
      async getFileHandle(name, {create} = {}) {
        const key = name.toLowerCase(), existing = entries.get(key);
        if (existing && existing.kind !== 'file') throw error('TypeMismatchError');
        if (existing) return existing;
        if (!create) throw error('NotFoundError');
        const file = {
          kind: 'file', name, bytes: new Uint8Array(),
          async getFile() {return new Blob([file.bytes]);},
          async createWritable() {
            let next;
            return {
              async write(data) {
                if (state.failWrite) throw error('QuotaExceededError');
                next = new Uint8Array(await new Blob([data]).arrayBuffer());
              },
              async close() {file.bytes = next; state.writes++;},
              async abort() {state.aborts++;}
            };
          }
        };
        entries.set(key, file); return file;
      },
      async removeEntry(name) {entries.delete(name.toLowerCase());}
    };
  }
  return {root: folder(name), state};
}
async function fileAt(root, path) {
  const parts = path.split('/');
  let parent = root;
  for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
  return parent.getFileHandle(parts.at(-1));
}
function uiFixture(saved, fs = {}) {
  const controls = Object.fromEntries(['saveMode','chooseDirectory','authorizeDirectory','destinationStatus','destinationPreview'].map(id => [id, {}]));
  const notes = [], writes = [];
  const controller = setupDestination({
    getFolder: () => '轮廓练习', getGrouping: () => 'category', isBusy: () => false,
    notify: (...args) => notes.push(args),
    document: {getElementById: id => controls[id]},
    window: {showDirectoryPicker: async () => {throw error('AbortError');}, ...fs},
    store: {read: async () => saved, write: async value => writes.push(value)}
  });
  return {controller, controls, notes, writes};
}

test('Images, ZIP and metadata are written under the selected folder with exact bytes', async () => {
  const {root} = directoryFixture();
  const target = {mode: 'directory', directory: root};
  const cases = [
    ['MAHO 拾图/轮廓练习/动物/001-猫.png', Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3])],
    ['MAHO 拾图/轮廓练习.zip', Uint8Array.from([80,75,3,4,0,9])],
    ['MAHO 拾图/轮廓练习/来源清单.json', new TextEncoder().encode('{"说明":"中文来源"}')],
    ['MAHO 拾图/轮廓练习/来源清单.csv', new TextEncoder().encode('分类,说明\r\n动物,猫')],
    ['MAHO 拾图/轮廓练习/整批素材记录.json', new TextEncoder().encode('{"items":[]}')]
  ];
  for (const [path, bytes] of cases) {
    const result = await saveOutput({target, path, blob: new Blob([bytes])}, {download: () => assert.fail('Must not use browser Downloads')});
    assert.equal(result.kind, 'directory');
    assert.equal(result.path, path.replace('MAHO 拾图/', ''));
    assert.deepEqual((await fileAt(root, result.path)).bytes, bytes);
  }
});

test('Existing files and concurrent duplicate names are preserved, including folder-name collisions', async () => {
  const {root} = directoryFixture();
  await writeUniqueFile(root, '练习/猫.png', new Blob(['original']));
  const results = await Promise.all(Array.from({length: 3}, (_, index) => writeUniqueFile(root, '练习/猫.png', new Blob([String(index)]))));
  assert.deepEqual(results, ['练习/猫 (1).png','练习/猫 (2).png','练习/猫 (3).png']);
  assert.equal(await (await fileAt(root, '练习/猫.png')).getFile().then(blob => blob.text()), 'original');
  await root.getDirectoryHandle('notes.json', {create: true});
  assert.equal(await writeUniqueFile(root, 'notes.json', new Blob(['notes'])), 'notes (1).json');
});

test('Unsafe or absolute paths never touch the chosen directory', async () => {
  for (const path of ['../x','/etc/file','C:/画稿/a.png','练习/../a','a\\b.png','a//b','a/./b']) {
    await assert.rejects(writeUniqueFile({queryPermission: () => assert.fail('Unsafe path accessed filesystem')}, path, new Blob()), /路径无效/);
  }
});

test('Permission denial prevents writes without silently changing the destination', async () => {
  const {root, state} = directoryFixture(); state.permission = 'denied';
  await assert.rejects(saveOutput({target: {mode: 'directory', directory: root}, path: 'MAHO 拾图/a.png', blob: new Blob(['x'])}, {download: () => assert.fail('No fallback without user choice')}), /允许写入/);
  assert.equal(state.writes, 0); assert.equal(state.requests, 0); assert.equal(root.entries.size, 0);
});

test('A failed write aborts and cleans only its new empty file', async () => {
  const {root, state} = directoryFixture();
  await writeUniqueFile(root, '猫.png', new Blob(['keep']));
  state.failWrite = true;
  await assert.rejects(writeUniqueFile(root, '猫.png', new Blob(['new'])), /QuotaExceededError/);
  assert.equal(state.aborts, 1); assert.equal(root.entries.size, 1);
  assert.equal(await (await fileAt(root, '猫.png')).getFile().then(blob => blob.text()), 'keep');
});

test('Browser and ask modes use distinct download options; cancellation propagates', async () => {
  const calls = [], api = {download: async options => {calls.push(options); return calls.length;}};
  const path = 'MAHO 拾图/练习/动物/001-猫.jpg';
  await saveOutput({target: {mode: 'browser'}, path, url: 'https://images.test/cat.jpg'}, api);
  await saveOutput({target: {mode: 'ask'}, path, blob: new Blob(['zip'])}, api);
  assert.equal(calls[0].saveAs, false); assert.equal(calls[0].filename, path);
  assert.equal(calls[1].saveAs, true); assert.equal(calls[1].filename, '001-猫.jpg');
  assert.equal(calls[0].conflictAction, 'uniquify'); assert.equal(calls[1].conflictAction, 'uniquify');
  await assert.rejects(saveOutput({target: {mode: 'ask'}, path, url: 'https://images.test/cat.jpg'}, {download: async () => {throw error('USER_CANCELED');}}), /USER_CANCELED/);
});

test('Restored directory permissions are queried, never requested until the user clicks', async () => {
  const {root, state} = directoryFixture(); state.permission = 'prompt';
  const {controller, controls} = uiFixture({mode: 'directory', directory: root});
  await controller.ready;
  assert.equal(state.requests, 0); assert.equal(controls.authorizeDirectory.hidden, false);
  assert.throws(() => controller.capture(), /允许写入/);
  await controls.authorizeDirectory.onclick();
  assert.equal(state.requests, 1); assert.equal(controller.capture().directory, root);
  assert.equal(controls.authorizeDirectory.hidden, true);
  state.permission = 'denied';
  await assert.rejects(controller.verify(controller.capture()), /允许写入/);
  assert.equal(controls.authorizeDirectory.hidden, false);
});

test('Cancel keeps the original folder; choosing another folder persists the actual handle', async () => {
  const original = directoryFixture('旧素材').root, next = directoryFixture('新素材').root;
  let cancel = true;
  const ui = uiFixture({mode: 'directory', directory: original}, {showDirectoryPicker: async options => {
    assert.equal(options.mode, 'readwrite');
    if (cancel) throw error('AbortError');
    return next;
  }});
  await ui.controller.ready;
  await ui.controls.chooseDirectory.onclick();
  assert.equal(ui.controller.capture().directory, original); assert.equal(ui.writes.length, 0);
  cancel = false; await ui.controls.chooseDirectory.onclick();
  assert.equal(ui.controller.capture().directory, next);
  assert.deepEqual(ui.writes, [{mode: 'directory', directory: next}]);
  assert.match(ui.controls.destinationPreview.textContent, /新素材.*轮廓练习.*我的分类/);
  const restored = uiFixture(ui.writes[0]); await restored.controller.ready;
  assert.equal(restored.controller.capture().directory, next);
});

test('Unsupported folder picker offers explicit fallback without changing mode silently', async () => {
  const ui = uiFixture({mode: 'directory'}, {showDirectoryPicker: undefined}); await ui.controller.ready;
  assert.equal(ui.controls.chooseDirectory.disabled, true);
  assert.throws(() => ui.controller.capture(), /每次弹窗选择位置/);
  ui.controls.saveMode.value = 'ask'; await ui.controls.saveMode.onchange();
  assert.equal(ui.controller.capture().mode, 'ask'); assert.equal(ui.writes[0].mode, 'ask');
});

test('ZIP button fetches images and saves its complete archive into the selected directory', async () => {
  const previous = {document: globalThis.document, chrome: globalThis.chrome, fetch: globalThis.fetch};
  const controls = {downloadZip: {}, stopZip: {}}, notes = [];
  const {root} = directoryFixture(); let busy = false, requested;
  try {
    globalThis.document = {getElementById: id => controls[id]};
    globalThis.chrome = {permissions: {request: async args => {requested = args; return true;}}, downloads: {download: () => assert.fail('ZIP must use chosen directory')}};
    globalThis.fetch = async () => new Response(Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]));
    setupZip({getSelected: () => [{url: 'https://images.test/cat.png', alt: '猫', category: '动物'}], getFolder: () => '练习', getOptions: () => ({grouping: 'category'}), getRows: rows => rows, isBusy: () => busy, setBusy: value => {busy = value;}, notify: note => notes.push(note), destination: {capture: () => ({mode: 'directory', directory: root}), verify: async () => {}}});
    await controls.downloadZip.onclick();
    assert.deepEqual(requested.origins, ['https://images.test/*']);
    const zip = (await fileAt(root, '练习.zip')).bytes;
    assert.deepEqual([...zip.slice(0, 4)], [80,75,3,4]);
    assert.ok(new TextDecoder().decode(zip).includes('来源清单.json'));
    assert.match(notes.at(-1), /ZIP 已保存到.*绘画素材.*1 张/); assert.equal(busy, false);
  } finally {Object.assign(globalThis, previous);}
});
