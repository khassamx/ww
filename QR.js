/*
Archivo QR.js - Muestra QR para WhatsApp Web y arranca el bot principal automáticamente
*/

const { default: makeWASocket, useSingleFileAuthState, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = './auth_info.json';
const { state, saveState } = useSingleFileAuthState(SESSION_FILE);

async function startQR() {
  const { version } = await fetchLatestBaileysVersion();
  console.log('Baileys version', version);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    version
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', (upd) => {
    const { connection, lastDisconnect } = upd;
    if(connection === 'close') {
      console.log('Conexión cerrada:', (lastDisconnect?.error)?.output?.statusCode || lastDisconnect?.error?.toString());
    } else if(connection === 'open') {
      console.log('Conectado a WhatsApp Web');
      startBotMain();
    }
  });
}

async function startBotMain() {
  console.log('Iniciando el bot principal...');
  try {
    // Importa y llama a la función startBot exportada del archivo principal
    const bot = require('./whatsapp-bot'); 
    await bot.startBot(); 

  } catch(e) {
    console.error('Error al iniciar el bot principal. ¿Está el archivo whatsapp-bot.js correcto? ', e);
  }
}

startQR().catch(err => console.error(err));