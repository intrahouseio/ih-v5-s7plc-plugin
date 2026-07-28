/**
 * s7plc index.js
 */
const util = require('util');

const client = require('./client');

let nextTimer; // таймер поллинга
let waiting;   // Флаг ожидания завершения операции (содержит ts старта операции или 0)
let toWrite = []; // Массив команд на запись
let plugin;
let chanValues = {};
let channels = {};


const sleep = ms => new Promise(resolve => nextTimer = setTimeout(resolve, ms));
(async () => {


  try {
    const opt = getOptFromArgs();
    const pluginapi = opt && opt.pluginapi ? opt.pluginapi : 'ih-plugin-api';
    plugin = require(pluginapi + '/index.js')();
    plugin.log('Plugin s7plc has started.', 1);

    plugin.params.data = await plugin.params.get();
    plugin.log('Received params data:' + util.inspect(plugin.params.data), 1);

    channels = await plugin.channels.get();
    plugin.log('Received channels data: ' + util.inspect(channels), 1);

    client.init(plugin);
    const groups = client.createGroups(channels);

    //const firstGroup = client.getNextGroup();
    //
    //channels = client.addItemsForGroup(firstGroup || []);  
    await client.connect();
    plugin.log('Connected!', 1);

    sendNext();
  } catch (err) {
    let res = [];
    channels.forEach(ch => {
      res.push({ id: ch.id, chstatus: 1, title: ch.chan });
    });
    plugin.sendData(res);
    plugin.log("err " + util.inspect(err));
    plugin.exit(8);
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
  let res = [];
  const currentSuperGroup = client.getNextGroup();
  try {
    // ← берём следующую супергруппу
    if (!currentSuperGroup) return;
    client.removeItems();                          // ← чистим предыдущие
    channels = client.addItemsForGroup(currentSuperGroup);  // ← добавляем новые
    const data = await client.readAll();
    //plugin.log("data " + util.inspect(data))
    if (data) {
      Object.keys(data).forEach(key => {
        if (typeof chanValues[key] !== 'object') chanValues[key] = {};
        const value = data[key];

        if (plugin.params.data.sendChanges) {
          if (chanValues[key].value != value) {
            res.push({ id: key, value, chstatus: 0, title: channels[key] });
            chanValues[key].value = value;
            chanValues[key].status = 0;
          }
        } else {
          res.push({ id: key, value, chstatus: 0, title: channels[key] });
          chanValues[key].status = 0;
        }
      });
    }

    if (res.length > 0) plugin.sendData(res);
  } catch (e) {
    plugin.log('Read error in supergroup: ' + util.inspect(e), 1);

    await readGroupIndividually(currentSuperGroup, res);
  }
}
/**
 * Поштучное чтение группы с исключением плохих адресов
 */
async function readGroupIndividually(superGroup, res) {
  plugin.log("1")
  if (!superGroup) return;

  for (const nodenameGroup of superGroup) {
    for (const id of Object.keys(nodenameGroup.variables)) {
      try {
        client.removeItems();

        // Формируем минимальную группу для одного тега
        const singleGroup = [{
          variables: { [id]: nodenameGroup.variables[id] },
          varChan: { [id]: nodenameGroup.varChan[id] }
        }];
        plugin.log("singleGroup " + util.inspect(singleGroup))
        channels = client.addItemsForGroup(singleGroup);

        const data = await client.readAll();

        if (data && data[id] !== undefined) {
          const value = data[id];
          if (typeof chanValues[id] !== 'object') chanValues[id] = {};

          if (plugin.params.data.sendChanges) {
            if (chanValues[id].value != value) {
              res.push({ id, value, chstatus: 0, title: channels[id] });
              chanValues[id].value = value;
            }
          } else {
            res.push({ id, value, chstatus: 0, title: channels[id] });
          }
          chanValues[id].status = 0;
        }
      } catch (e) {
        // ← добавляем в blacklist
        plugin.log(`Bad tag ${id} - added to blacklist`, 1);

        client.badTags.add(id);

        if (typeof chanValues[id] !== 'object') chanValues[id] = {};
        chanValues[id].status = 1;

        res.push({ id, chstatus: 1, title: channels[id] || id });

      }
    }
  }

  if (res.length > 0) plugin.sendData(res);
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
    if (toWrite.length === 0) return;

    const items = [];
    const values = [];
    const writeVariables = {};

    toWrite.forEach(item => {
      items.push(item.id);
      values.push(item.value);

      let addr = item.address || '';
      if (item.nodename) {
        addr = item.nodename + "," + addr;
      }
      writeVariables[item.id] = addr;
    });

    const pending = [...toWrite];
    toWrite = [];

    // Подготовка к записи
    client.removeItems();
    client.variables = writeVariables;
    client.conn.setTranslationCB(tag => client.variables[tag]);
    client.conn.addItems(items);

    await client.write(items, values);

    plugin.log('Write completed: ' + items.join(',') + " = " + values.join(','), 1);

  } catch (e) {
    plugin.log('Write ERROR: ' + util.inspect(e), 1);
  } finally {
    client.removeItems();   // обязательно чистим после записи
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
  plugin.log('ACT data=' + util.inspect(message.data), 1);

  if (!message.data) return;
  message.data.forEach(item => {
    toWrite.push({ id: item.id, value: item.value, address: item.address, nodename: item.nodename });
  });
  // Попытаться отправить на контроллер
  // Сбросить таймер поллинга, чтобы не случилось наложения
  //clearTimeout(nextTimer);
  //sendNext();
});

plugin.channels.onChange(async function (data) {
  try {
    //clearTimeout(nextTimer);
    //client.removeItems();
    channels = await plugin.channels.get();
    client.createGroups(channels);
    //channels = client.addItems(plugin.channels.data);
    chanValues = {};
    //sendNext();
  } catch (e) {
    plugin.log('ERROR onChange: ' + util.inspect(e), 1);
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
