/**
 * client.js
 */

const util = require('util');

// const S7 = require('nodes7');
// const S7 = require('./lib/fakeS7');

const variables = {};

module.exports = {
  conn: '',

  init(plugin) {
    this.plugin = plugin;
    if (plugin.params.data.useFakeS7) {
      this.plugin.log('USE fake S7!');

      const S7 = require('./lib/fakeS7');
      this.conn = new S7(plugin);
    } else {
      const S7 = require('nodes7');
      this.conn = new S7();
    }

    this.conn.setTranslationCB(tag => variables[tag]);

    // Заполнить variables из каналов
    this.plugin.channels.data.forEach(item => {
      variables[item.id] = item.address;
    });
    this.plugin.log('Variables mapping: ' + util.inspect(variables));

    // Заполнить read pool для readAll
    this.conn.addItems(Object.keys(variables));
  },

  connect() {
    const host = this.plugin.params.data.host;

    const port = Number(this.plugin.params.data.port);
    const rack = Number(this.plugin.params.data.rack);
    const slot = Number(this.plugin.params.data.slot);

    this.plugin.log('Try connect to ' + host + ':' + port);

    // const cParam = { port, host, rack: 0, slot: 1 };
    const cParam = { port, host, rack, slot};
   

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
