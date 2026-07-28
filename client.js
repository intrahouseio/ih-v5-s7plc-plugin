/**
 * client.js
 */

const util = require('util');

const S7 = require('nodes7');
// const S7 = require('./lib/fakeS7');

let variables = {};


module.exports = {
  conn: '',
  varChan: {},
  variables: {},
  wvariables: {},
  readGroups: [],           // Массив супергрупп
  currentGroupIndex: 0,
  maxGroupsPerRead: 8,
  badTags: new Set(),
  init(plugin) {
    this.plugin = plugin;
    this.conn = new S7({ silent: true });
    this.maxGroupsPerRead = plugin.params.data.maxGroupsPerRead || 8;
    /*if (plugin.params.data.useFakeS7) {
      this.plugin.log('USE fake S7!', 1);

      const S7 = require('./lib/fakeS7');
      this.conn = new S7(plugin);
    } else {
      const S7 = require('nodes7');
      this.conn = new S7({silent:true });
    }
    
    this.addItems(this.plugin.channels.data);
    */
  },

  createGroups(channels) {
    const nodenameGroups = {};
    this.badTags.clear();
    channels.forEach(ch => {
      const key = ch.nodename || '__default__';

      if (!nodenameGroups[key]) {
        nodenameGroups[key] = {
          name: key,
          channels: [],
          variables: {},
          varChan: {}
        };
      }

      const group = nodenameGroups[key];
      const originalAddress = ch.address;

      // НЕ мутируем оригинальный ch!
      const fullAddress = ch.nodename
        ? (ch.nodename + "," + originalAddress)
        : originalAddress;

      const displayChan = ch.nodename
        ? (ch.nodename + "_" + ch.chan)
        : ch.chan;

      group.channels.push(ch);
      group.variables[ch.id] = fullAddress;
      group.varChan[ch.id] = displayChan;
    });

    let groupList = Object.values(nodenameGroups);

    this.readGroups = [];
    for (let i = 0; i < groupList.length; i += this.maxGroupsPerRead) {
      this.readGroups.push(groupList.slice(i, i + this.maxGroupsPerRead));
    }

    this.plugin.log(`Создано ${this.readGroups.length} супергрупп`, 1);
    return this.readGroups;
  },

  /**
   * Добавляет каналы только из одной супергруппы
   */
  addItemsForGroup(superGroup) {
    this.removeItems();

    this.variables = {};
    this.varChan = {};

    let added = 0;

    superGroup.forEach(nodenameGroup => {
      if (!nodenameGroup?.variables) return;

      Object.keys(nodenameGroup.variables).forEach(id => {
        if (this.badTags.has(id)) return; // ← пропускаем плохие

        const addr = nodenameGroup.variables[id];
        if (typeof addr !== 'string' || addr.trim() === '') {
          this.badTags.add(id);
          this.plugin.log(`Bad address detected and blacklisted: ${id}`, 1);
          return;
        }

        this.variables[id] = addr;
        this.varChan[id] = nodenameGroup.varChan[id] || id;
        added++;
      });
    });

    try {
      this.conn.setTranslationCB(tag => this.variables[tag]);
      this.conn.addItems(Object.keys(this.variables));
      //this.plugin.log(`addItemsForGroup: added ${added} tags (${this.badTags.size} blacklisted)`);
    } catch (e) {
      this.plugin.log("addItemsForGroup error: " + util.inspect(e), 1);
    }

    return this.varChan;
  },

  removeItems() {
    try {
      if (Object.keys(this.variables).length > 0) {
        this.conn.removeItems(Object.keys(this.variables));
        this.varChan = {};
        this.variables = {};
      }

    } catch (e) {
      this.plugin.log('ERROR removeItems: ' + util.inspect(e));
    }
  },

  addItems(arr) {
    arr.forEach(item => {
      let adr = "";
      let chan = "";
      if (item.nodename) {
        adr = item.nodename + "," + item.address;
        chan = item.nodename + "_" + item.chan;
      } else {
        adr = item.address;
        chan = item.chan;
      }
      this.variables[String(item.id)] = adr;
    })
    this.plugin.log("variables " + util.inspect(this.variables))
    try {
      this.conn.setTranslationCB(tag => this.variables[tag]);
      this.conn.addItems(Object.keys(this.variables));
    } catch (e) {
      this.plugin.log("error addItems + " + util.inspect(e))
    }

  },

  getNextGroup() {
    if (this.readGroups.length === 0) return null;
    const group = this.readGroups[this.currentGroupIndex];
    this.currentGroupIndex = (this.currentGroupIndex + 1) % this.readGroups.length;
    return group;
  },

  connect() {
    const host = this.plugin.params.data.host;

    const port = Number(this.plugin.params.data.port);
    const rack = Number(this.plugin.params.data.rack);
    const slot = Number(this.plugin.params.data.slot);

    this.plugin.log('Try connect to ' + host + ':' + port);

    // const cParam = { port, host, rack: 0, slot: 1 };
    const cParam = { port, host, rack, slot };


    return new Promise((resolve, reject) => {
      this.conn.initiateConnection(cParam, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  },

  readAll() {
    return new Promise((resolve, reject) => {
      this.conn.readAllItems((err, values) => {
        if (err) {
          reject(err);
        } else {
          resolve(values);
        }
      });
    });
  },

  write(items, values) {
    return new Promise((resolve, reject) => {
      // this.conn.writeItems(['TEST5', 'TEST6'], [ 867.5309, 9 ], valuesWritten);
      this.conn.writeItems(items, values, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  },

  close() {
    return new Promise((resolve, reject) => {
      this.conn.dropConnection(err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
};
