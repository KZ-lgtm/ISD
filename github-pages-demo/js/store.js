/* Intelligent Spray demo - persistence in IndexedDB (no ~5 MB localStorage cap): recipes, cycle log, settings.
   Falls back to an in-memory store (with `persistent = false`) when IndexedDB is unavailable, e.g. some private windows. */
(function (root) {
  'use strict';

  var DB_NAME = 'isd-spray-demo', DB_VERSION = 1;
  var LEGACY_RECIPES_KEY = 'ispDemoRecipes';

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function MemoryStore() { this.recipes = {}; this.log = []; this.settings = {}; this.nextId = 1; this.persistent = false; }
  MemoryStore.prototype = {
    getAllRecipes: function () { var r = this.recipes; return Promise.resolve(Object.keys(r).map(function (k) { return r[k]; })); },
    putRecipe: function (rec) { this.recipes[rec.name] = rec; return Promise.resolve(); },
    deleteRecipe: function (name) { delete this.recipes[name]; return Promise.resolve(); },
    getLog: function () { return Promise.resolve(this.log.slice()); },
    addLog: function (e) { e.id = this.nextId++; this.log.push(e); return Promise.resolve(e.id); },
    putLog: function (e) { var i = this.log.findIndex(function (x) { return x.id === e.id; }); if (i >= 0) this.log[i] = e; return Promise.resolve(); },
    clearLog: function () { this.log = []; return Promise.resolve(); },
    trimLog: function () { return Promise.resolve(); },
    getSetting: function (k) { return Promise.resolve(this.settings[k]); },
    putSetting: function (k, v) { this.settings[k] = v; return Promise.resolve(); }
  };

  function IdbStore(db) { this.db = db; this.persistent = true; }
  IdbStore.prototype = {
    tx: function (store, mode) { return this.db.transaction(store, mode).objectStore(store); },
    getAllRecipes: function () { return req(this.tx('recipes', 'readonly').getAll()); },
    putRecipe: function (rec) { return req(this.tx('recipes', 'readwrite').put(rec)); },
    deleteRecipe: function (name) { return req(this.tx('recipes', 'readwrite').delete(name)); },
    getLog: function () { return req(this.tx('log', 'readonly').getAll()); },
    addLog: function (e) { return req(this.tx('log', 'readwrite').add(e)); },
    putLog: function (e) { return req(this.tx('log', 'readwrite').put(e)); },
    clearLog: function () { return req(this.tx('log', 'readwrite').clear()); },
    /** Keeps only the newest `max` log entries. */
    trimLog: function (max) {
      var self = this;
      return req(this.tx('log', 'readonly').getAllKeys()).then(function (keys) {
        if (keys.length <= max) return;
        var os = self.tx('log', 'readwrite');
        return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return req(os.delete(k)); }));
      });
    },
    getSetting: function (k) { return req(this.tx('settings', 'readonly').get(k)); },
    putSetting: function (k, v) { return req(this.tx('settings', 'readwrite').put(v, k)); }
  };

  /** Moves recipes saved by earlier versions of the demo (localStorage) into the store, once. */
  function migrateLegacy(store) {
    var legacy;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_RECIPES_KEY) || 'null'); } catch (e) { legacy = null; }
    if (!legacy) return Promise.resolve();
    return Promise.all(Object.keys(legacy).map(function (name) {
      var r = legacy[name]; r.name = name;
      return store.putRecipe(r);
    })).then(function () {
      if (store.persistent) { try { localStorage.removeItem(LEGACY_RECIPES_KEY); } catch (e) { } }
    });
  }

  function open() {
    if (!root.indexedDB) return Promise.resolve(new MemoryStore());
    return new Promise(function (resolve) {
      var r;
      try { r = root.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { resolve(new MemoryStore()); return; }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      r.onsuccess = function () { resolve(new IdbStore(r.result)); };
      r.onerror = function () { resolve(new MemoryStore()); };
      r.onblocked = function () { resolve(new MemoryStore()); };
    }).then(function (store) {
      return migrateLegacy(store).then(function () { return store; }, function () { return store; });
    });
  }

  root.ISDStore = { open: open };
})(window);
