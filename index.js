/**
 * s7plc index.js
 */
const util = require('util');

// const plugin = require('ih-plugin-api')();
const client = require('./client');

let nextTimer; // таймер поллинга
let waiting;   // Флаг ожидания завершения операции (содержит ts старта операции или 0)
let toWrite = []; // Массив команд на запись

(async () => {
 
  let plugin;
  try {
    const opt = getOptFromArgs();
    const pluginapi = opt && opt.pluginapi ? opt.pluginapi : 'ih-plugin-api';
    plugin = require(pluginapi+'/index.js')();
    plugin.log('Plugin s7plc has started.', 0);
    
    plugin.params.data = await plugin.params.get();
    plugin.log('Received params data:' + util.inspect(plugin.params.data));

    plugin.channels.data = await plugin.channels.get();
    plugin.log('Received channels data: ' + util.inspect(plugin.channels.data));

    client.init(plugin);
    await client.connect();
    plugin.log('Connected!');

    sendNext();
  } catch (err) {
    plugin.exit(8, util.inspect(err));
  }
})();

/*  sendNext
*   Отправка на контроллер запроса на чтение или запись
* 
*    Для чтения функция запускается по таймеру nextTimer 
*    Если пришла команда на запись - таймер сбрасывается и функция вызывается напрямую
*
*    Если функция вызвана, а предыдущая операция не завершена (возможно при записи )
*     то ожидаем окончания операции (для этого взводим короткий таймер)
*/
async function sendNext() {
  if (waiting) {
    // TODO Если ожидание длится долго - сбросить флаг и выполнить следующую операцию
    nextTimer = setTimeout(sendNext, 100); // min interval?
    return;
  }

  let nextDelay = plugin.params.data.polldelay; // стандартный интервал опроса
  waiting = Date.now();
  if (toWrite.length) {
    await write();
    nextDelay = 100; // интервал - чтение после записи
  } else {
    await read();
  }
  waiting = 0;
  nextTimer = setTimeout(sendNext, nextDelay); 
}

/*  read
*   Отправляет команду чтения на контроллер, ожидает результат
*   Преобразует результат и отправляет данные на сервер {id, value}
*
*   !Библиотека предоставляет только функцию readAllItems
*    "It sorts a large number of items being requested from the PLC and decides 
*     what overall data areas to request, then it groups multiple small requests 
*     together in a single packet or number of packets up to the maximum length the PLC supports, 
*     then it sends multiple packets at once, for maximum speed."
*/
async function read() {
  try {
    const data = await client.readAll();
    if (data) {
      plugin.log('Read from PLC: ' + util.inspect(data));
      const res = Object.keys(data).map(key => ({ id: key, value: data[key] }));
      plugin.sendData(res);
    }
  } catch (e) {
    plugin.log('Read error: ' + util.inspect(e));
  }
}

/*  write
*   Отправляет команду записи на контроллер и ожидает завершения 
*   Данные для отправки находятся в массиве toWrite = [{id, value}]
*   (возможно накопление нескольких команд при ожидании окончания предыдущей операции)
*
*  Перед отправкой данные разделяются на массивы items = ['TEST1','TEST2'] и values = [42,1] 
*   так как функция библиотеки writeItems(items, values) принимает 2 массива:
*   "Writes items to the PLC using the corresponding values"

*  Массив toWrite очищается
*/
async function write() {
  try {
    const items = [];
    const values = [];
    toWrite.forEach(wrObj => {
      items.push(wrObj.id)
      values.push(wrObj.value)
    });
    toWrite = [];
    
    await client.write(items, values);
    plugin.log('Write completed', items, values);
  } catch (e) {
    plugin.log('Write ERROR: ' + util.inspect(e));
  }
}

function getOptFromArgs() {
  let opt;
  try {
    opt = JSON.parse(process.argv[2]); //
  } catch (e) {
    opt = {};
  }
  return opt;
}


// Сообщения от сервера
/**  act
 * Получили от сервера команду(ы) для устройства - пытаться отправить на контроллер
 *
 * @param {Array of Objects} - message.data - массив команд
 */
plugin.onAct(message => {
  //console.log('Write recieve', message);
  plugin.log('ACT data=' + util.inspect(message.data));
  
  if (!message.data) return;
  message.data.forEach(item => {
    toWrite.push({id:item.id, value:item.value});
  });
  // Попытаться отправить на контроллер
  // Сбросить таймер поллинга, чтобы не случилось наложения
  clearTimeout(nextTimer);
  sendNext();
});

plugin.channels.onChange(async function () {
  try {
    clearTimeout(nextTimer);
    client.removeItems();
    plugin.channels.data = await plugin.channels.get(); 
    
    client.addItems(plugin.channels);
    sendNext();
    } catch (e) {
      plugin.log('ERROR onChange: ' + util.inspect(e));
    }
  
});

// Завершение работы
function terminate() {
  client.close();
}

process.on('exit', terminate);
process.on('SIGTERM', () => {
  process.exit(0);
});
