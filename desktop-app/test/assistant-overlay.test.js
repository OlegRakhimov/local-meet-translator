const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAssistantSettings, sanitizeSuggestion, createAssistantOverlayController } = require('../src/main/assistant-overlay');

test('assistant settings keep AI auto-analysis disabled by default', () => {
  const settings = normalizeAssistantSettings({}, 'win32');
  assert.equal(settings.enabled, true);
  assert.equal(settings.autoAnalyze, false);
  assert.equal(settings.contentProtection, true);
  assert.equal(settings.languageLevel, 'B1');
});

test('suggestion sanitizer bounds structured content', () => {
  const suggestion = sanitizeSuggestion({ source:'library', firstSentence:'Start.', answer:'Answer.', keyPoints:['One'], basis:['Fact'], confidence:'high' });
  assert.equal(suggestion.source, 'library');
  assert.deepEqual(suggestion.keyPoints, ['One']);
  assert.equal(suggestion.confidence, 'high');
});

test('controller applies content protection and keeps question local', async () => {
  const calls = [];
  class FakeWindow {
    constructor(options) { this.options=options; this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:(...args)=>calls.push(args), on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:600,height:700};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true',INTERVIEW_ASSISTANT_CONTENT_PROTECTION:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setQuestion({id:'q',text:'Tell me about yourself'});
  assert.equal(controller.snapshot().question.text, 'Tell me about yourself');
  assert.equal(controller.snapshot().protection.applied, true);
  assert.ok(calls.some(call => call[0] === 'assistant-overlay:state'));
});

test('frozen assistant queues a different answer until the user loads it', () => {
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setIgnoreMouseEvents(){} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_ENABLED:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setQuestion({id:'q1',text:'First question?'});
  controller.setSuggestion({question:'First question?',answer:'First answer.',firstSentence:'First answer.'});
  controller.setFrozen(true);
  controller.setQuestion({id:'q2',text:'Second question?'});
  controller.setSuggestion({question:'Second question?',answer:'Second answer.',firstSentence:'Second answer.'});
  assert.equal(controller.snapshot().suggestion.question, 'First question?');
  assert.equal(controller.snapshot().teleprompter.pending.suggestion.question, 'Second question?');
  controller.loadPending();
  assert.equal(controller.snapshot().suggestion.question, 'Second question?');
});

test('move mode temporarily restores mouse interaction and remains movable', () => {
  const ignoreCalls = [];
  let movable = false;
  class FakeWindow {
    constructor() { this.visible=false; this.destroyed=false; this.protected=false; this.webContents={ isDestroyed:()=>false, send:()=>{}, on:()=>{} }; }
    setAlwaysOnTop(){} setContentProtection(v){this.protected=v;} isContentProtected(){return this.protected;}
    setMovable(value){movable=value;} setIgnoreMouseEvents(value){ignoreCalls.push(value);} setOpacity(){} loadFile(){return Promise.resolve();} on(){} isDestroyed(){return this.destroyed;}
    isVisible(){return this.visible;} showInactive(){this.visible=true;} show(){this.visible=true;} focus(){} hide(){this.visible=false;}
    getNormalBounds(){return {x:0,y:0,width:680,height:780};} setBounds(){} destroy(){this.destroyed=true;}
  }
  const controller = createAssistantOverlayController({
    BrowserWindow:FakeWindow,
    screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1600,height:900}}),getAllDisplays:()=>[{workArea:{x:0,y:0,width:1600,height:900}}],on:()=>{}},
    globalShortcut:{register:()=>true,unregister:()=>{}}, preloadPath:'preload', htmlPath:'html', statePath:'',
    loadSettings:()=>({INTERVIEW_ASSISTANT_CLICK_THROUGH:'true'}), saveSettings:()=>{}, platform:'win32'
  });
  controller.initialize();
  controller.setMoveMode(true);
  assert.equal(controller.snapshot().moveMode, true);
  assert.equal(movable, true);
  assert.equal(ignoreCalls.at(-1), false);
  controller.setMoveMode(false);
  assert.equal(ignoreCalls.at(-1), true);
});
