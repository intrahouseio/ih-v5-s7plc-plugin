/**
 * app.js
 *
 */

const util = require('util');
const client = require('./client');

const variables = {
  TEST1: 'DB1,REAL0'
/*
  TEST2: 'M32.2'
 
  TEST1: 'MR4', // Memory real at MD4
  TEST2: 'M32.2', // Bit at M32.2
  TEST3: 'M20.0', // Bit at M20.0
  TEST4: 'DB1,REAL0.20', // Array of 20 values in DB1
  TEST5: 'DB1,REAL4', // Single real value
  TEST6: 'DB1,REAL8' // Another single real value
  TEST7: 'DB1,INT12.2',  // Two integer value array
  TEST8: 'DB1,LREAL4'    // Single 8-byte real value
  */
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function(plugin) {
  process.on('exit', terminate);
  process.on('SIGTERM', () => {
    terminate();
    process.exit(0);
  });

  try {
    client.init();
    client.conn.setTranslationCB((tag) => variables[tag]);
    const {port, host, timeout, polldelay} = plugin.params.data;

    await client.connect({ port: 102, host: '192.168.0.77', rack: 0, slot: 1 });
    plugin.log('Try connect to ' + host + ':' + port);
    // await client.connect({ port, host, rack: 0, slot: 1 });
    plugin.log('Connected to ' + host + ':' + port);

    client.conn.addItems(['TEST1']);
    await read();
  } catch (err) {
    checkError(err);
  }

  async function read() {
    try {
      const values = await client.readAll();
      plugin.log('Get ReadAll result: ' + util.inspect(values));
      
      setTimeout(() => {
        // Следующее чтение

      }, 100);

    } catch (err) {
      plugin.log('Get ReadAll error: ' + util.inspect(err));
    }
  }

  function checkError(err) {
    plugin.log('Get Error: ' + util.inspect(err));
  }

  async function terminate() {
    console.log('TERMINATE PLUGIN');
    await client.close();
  }
};
