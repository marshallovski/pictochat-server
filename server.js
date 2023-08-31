const WebSocket = require('ws');
const config = require('./config.json');
const rooms = require('./rooms.json');
const wss = new WebSocket.Server({ port: config.port, host: config.host });

const users = [];
const abusers = [];

wss.on('listening', () => console.log(`Server listening at ws://${wss.address().address}:${wss.address().port}`));
wss.on('error', (e) => console.error(e));

wss.on('connection', async (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    let rate = 0;
    let playerData = null;

    console.log(`Connected from ${clientIP}`);
    rate++;

    // rate limiting; taken from https://github.com/ayunami2000/ayunpictonode
    let rateInterval = setInterval(() => {
        if (rate >= 10) {
            abusers.push(clientIP);
            setTimeout(() => {
                let ind = abusers.indexOf(clientIP);
                if (ind > -1) {
                    abusers.splice(clientIP, 1);
                }
            }, 10000);

            ws.close();
        } else {
            rate = 0;
        }
    }, 5000);

    ws.on('message', async (data) => {
        let obj;

        data = data.toString();

        if (data === 'pong') {
            return setTimeout(() => ws.send('ping'), 10000);
        }

        if (!data.includes('type')) return ws.close(1006, 'No `type` specified.');
        rate++;

        // validating JSON
        try {
            obj = JSON.parse(data);
        } catch {
            return null;
        }

        try {
            switch (obj.type) {
                case 'cl_verifyName':
                    if (!obj.player || !obj.player.name || !obj.player.color)
                        return ws.close(1006, 'Some parameters are empty');

                    if (obj.player.name.length > 10) ws.close();

                    playerData = obj.player;

                    ws.send(JSON.stringify({
                        type: "sv_nameVerified",
                        player: {
                            name: playerData.name,
                            color: playerData.color
                        }
                    }));

                    ws.send(JSON.stringify({
                        type: "sv_roomIds",
                        count: [users.length],
                        ids: rooms
                    }));
                    break;

                case 'cl_joinRoom':
                    if (!obj.player || !obj.player.name || !obj.player.color || !obj.id)
                        return ws.close(1006);

                    users.push(playerData);
                    console.log(`${playerData.name} joined ${obj.id}`);

                    ws.send(JSON.stringify({
                        type: "sv_roomData",
                        id: obj.id
                    }));

                    wss.clients.forEach(
                        client => client.send(
                            JSON.stringify({ type: "sv_playerJoined", player: playerData, id: obj.id })
                        )
                    );
                    break;

                case 'cl_sendMessage':
                    if (
                        !Array.isArray(obj.message.textboxes) &&
                        !isNaN(obj.message.lines) &&
                        obj.message.lines <= 5 &&
                        obj.message.lines > 0
                    )
                        return ws.close();

                    // taken from https://github.com/ayunami2000/ayunpictonode
                    for (let i = 0; i < obj.message.textboxes.length; i++) {
                        if (obj.message.textboxes[i].text)
                            obj.message.textboxes[i].text = obj.message.textboxes[i].text.slice(0, 30);
                    }

                    obj.message.textboxes = obj.message.textboxes.slice(0, 50);
                    obj.type = "sv_receivedMessage";
                    obj.message.player = playerData;

                    // sending message to all
                    wss.clients.forEach(client => client.send(JSON.stringify(obj)));

                    console.log(`message from ${obj.message.player.name}: `, obj.message.textboxes);
                    break;

                case 'cl_leaveRoom':
                    clearInterval(rateInterval);

                    if (playerData) {
                        let ind = users.indexOf(playerData);
                        if (ind > -1) {
                            users.splice(ind, 1);

                            wss.clients.forEach(
                                client => client.send(
                                    JSON.stringify({
                                        type: "sv_playerLeft",
                                        player: playerData,
                                        id: obj.id
                                    })
                                )
                            );

                            console.log(`${playerData.name} left ${obj.id}`);
                        }
                    }
                    break;

                default:
                    console.log(obj, `^ unhandled client data type (${obj.type})`);
                    break;
            }
        } catch (e) {
            console.error(e);

            ws.close();
        }
    });

});