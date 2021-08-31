/**
 *
 */

const util = require('util');

const readPool = {};
const writePool = {};

class FakeS7 {
  constructor(plugin) {
    this.plugin = plugin;
  }

  setTranslationCB() {
    this.plugin.log('FakeS7: Run setTranslationCB')
  }

  initiateConnection(cParam, callback) {
    this.plugin.log('FakeS7: Run initiateConnection with '+util.inspect(cParam))
    callback();
  }


  // Adds items to the internal read polling list.
  addItems(items) {
    this.plugin.log('FakeS7: Run addItems with '+util.inspect(items));
    items.forEach(item => {
      readPool[item] = 1;
    })
  }

  readAllItems(callback) {
    const data = {}
    Object.keys(readPool).forEach(key => {
      if (!writePool[key]) {
        // Если в канал пишут - его уже не меняем
        readPool[key] = Math.floor(Math.random()*100)/10;
      }
      data[key] = readPool[key];

    });
    this.plugin.log('FakeS7: Run readAllItems '+util.inspect(data))
    callback(null, data);
  }

  writeItems(items, values, callback) {
    this.plugin.log('FakeS7:Run writeItems items:'+util.inspect(items)+'  values:'+util.inspect(values));
    for (let i=0; i< items.length; i++) {
      const key = items[i];
      writePool[key] = 1;
      readPool[key] =  values[i];
    }

    callback();
  }

  dropConnection(callback) {
    this.plugin.log('FakeS7: Run dropConnection')
    callback();
  }
}

module.exports = FakeS7;
