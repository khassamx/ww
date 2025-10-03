/*
Whatsapp personal bot (Node.js) - Archivo Principal de Lógica
*/

const { default: makeWASocket, DisconnectReason, useSingleFileAuthState, fetchLatestBaileysVersion, WAMessageStubType } = require('@adiwajshing/baileys');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
const fs = require('fs-extra');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const TikTokScraper = require('tiktok-scraper');
const IGDownloader = require('instagram-video-downloader');
const moment = require('moment');

ffmpeg.setFfmpegPath(ffmpegPath);

const SESSION_FILE = './auth_info.json';
const { state, saveState } = useSingleFileAuthState(SESSION_FILE);

// Definición y creación de la carpeta 'plugins'
const TEMP_DIR = path.join(__dirname, 'plugins');
fs.ensureDirSync(TEMP_DIR);

const pending = new Map();

async function startBot() {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log('Baileys version', version, 'isLatest?', isLatest);

  const sock = makeWASocket({ auth: state, printQRInTerminal: true, version });
  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', (upd) => {
    const { connection, lastDisconnect } = upd;
    if (connection === 'close') {
      console.log('Connection closed:', (lastDisconnect?.error)?.output?.statusCode || lastDisconnect?.error?.toString());
    } else if (connection === 'open') {
      console.log('Conectado a WhatsApp y bot principal en ejecución.');
    }
  });

  // --- MANEJO DE COMANDOS (., .play, .tiktok, .ig, etc.) ---
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (!msg.message) continue;
        if (msg.key && msg.key.remoteJid === 'status@broadcast') continue;
        
        const sender = msg.key.participant || msg.key.remoteJid;
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        
        const text = getTextFromMessage(msg.message);
        if (!text) continue;
        if (!text.startsWith('.')) continue;
        
        const args = text.trim().split(/\s+/);
        const cmd = args[0].slice(1).toLowerCase();

        if (cmd === 'kick') {
            // Lógica de kick (sin cambios)
        }

        else if (cmd === 'play') {
            const query = args.slice(1).join(' ');
            if (!query) { await sock.sendMessage(from, { text: 'Usa: .play <URL o búsqueda>' }, { quoted: msg }); continue; }
        
            try {
                let videoInfo;
                let isUrl = ytdl.validateURL(query);
                let result = {};
        
                if (isUrl) {
                    videoInfo = await ytdl.getInfo(query);
                    result.title = videoInfo.videoDetails.title;
                    result.videoId = videoInfo.videoDetails.videoId;
                    result.thumbnailUrl = videoInfo.videoDetails.thumbnails.slice(-1)[0].url; 
                } else {
                    const searchResults = await yts(query);
                    if (!searchResults.videos.length) {
                        await sock.sendMessage(from, { text: 'No se encontraron resultados en YouTube.' }, { quoted: msg });
                        return;
                    }
                    const firstResult = searchResults.videos[0];
                    result.title = firstResult.title;
                    result.videoId = firstResult.videoId;
                    result.thumbnailUrl = firstResult.thumbnail;
                }
        
                // 1. OBTENER MINATURA
                let thumbnailBuffer = null;
                if (result.thumbnailUrl) {
                    thumbnailBuffer = await fetch(result.thumbnailUrl).then(res => res.buffer());
                }
        
                // 2. CREAR MENSAJE DE BOTONES CON VISTA PREVIA
                const buttons = [
                    { buttonId: `send_audio_${result.videoId}`, buttonText: { displayText: 'Enviar audio' }, type: 1 },
                    { buttonId: `send_video_${result.videoId}`, buttonText: { displayText: 'Enviar video' }, type: 1 },
                ];
        
                const buttonMessage = {
                    text: `Video encontrado: **${result.title}**\n\nSelecciona el formato de descarga:`,
                    footer: 'YouTube',
                    buttons: buttons,
                    headerType: 1, 
                    jpegThumbnail: thumbnailBuffer // AÑADIDO: miniatura
                };
        
                const sentMsg = await sock.sendMessage(from, buttonMessage, { quoted: msg });
        
                // Guardamos toda la información, incluyendo el thumbnailBuffer, en el mapa 'pending'
                pending.set(sentMsg.key.id, {
                    videoId: result.videoId,
                    title: result.title,
                    from: from,
                    msg: msg,
                    videoPath: path.join(TEMP_DIR, `tmp-yt-${result.videoId}.mp4`),
                    audioPath: path.join(TEMP_DIR, `tmp-yt-${result.videoId}.mp3`),
                    thumbnailBuffer: thumbnailBuffer // AÑADIDO: Guardar el buffer
                });
                
            } catch (e) {
                console.error('Error en .play:', e);
                await sock.sendMessage(from, { text: '❌ Ocurrió un error al buscar o procesar el video de YouTube.' }, { quoted: msg });
            }
        }

        else if (cmd === 'tiktok') {
            const url = args[1];
            if (!url) { await sock.sendMessage(from, { text: 'Usa: .tiktok <URL>' }, { quoted: msg }); continue; }
            const id = Date.now() + '-' + Math.random().toString(36).slice(2,8);
            // USANDO TEMP_DIR (plugins)
            const videoPath = path.join(TEMP_DIR, `tmp-tiktok-${id}.mp4`); 
            
            try {
                // 1. OBTENER METADATOS Y VISTA PREVIA
                const videoMeta = await TikTokScraper.getVideoMeta(url);
                
                const title = videoMeta.description || 'Video de TikTok';
                const coverUrl = videoMeta.cover;
                let thumbnailBuffer = null;

                if (coverUrl) {
                    thumbnailBuffer = await fetch(coverUrl).then(res => res.buffer());
                }

                // 2. ENVIAR MENSAJE DE VISTA PREVIA Y ESTADO
                await sock.sendMessage(from, { 
                    text: `Título: **${title}**\n\nDescargando video de TikTok...`,
                    jpegThumbnail: thumbnailBuffer, // Miniatura en el mensaje de espera
                }, { quoted: msg });

                // 3. DESCARGA Y ENVÍO DEL VIDEO REAL
                const videoBuffer = await fetch(videoMeta.videoUrl).then(res => res.buffer());
                fs.writeFileSync(videoPath, videoBuffer);
                
                await sock.sendMessage(from, { 
                    video: fs.readFileSync(videoPath), 
                    mimetype: 'video/mp4',
                    caption: `✅ **${title}**`, 
                    jpegThumbnail: thumbnailBuffer // Miniatura en el mensaje final
                });
                
                fs.unlinkSync(videoPath); 
            } catch (e) { 
                console.error(e); 
                await sock.sendMessage(from, { text: '❌ Error al descargar TikTok. Asegúrate de que la URL sea pública y válida.' }, { quoted: msg }); 
            }
        }

        else if (cmd === 'ig') {
            const url = args[1];
            if (!url) { await sock.sendMessage(from, { text: 'Usa: .ig <URL>' }, { quoted: msg }); continue; }
            const id = Date.now() + '-' + Math.random().toString(36).slice(2,8);
            // USANDO TEMP_DIR (plugins)
            const videoPath = path.join(TEMP_DIR, `tmp-ig-${id}.mp4`); 
            
            try {
                // 1. OBTENER METADATOS Y VISTA PREVIA
                const igData = await IGDownloader(url);
                
                const title = igData.caption || 'Video de Instagram';
                const coverUrl = igData.thumbnail_url;
                let thumbnailBuffer = null;

                if (coverUrl) {
                    thumbnailBuffer = await fetch(coverUrl).then(res => res.buffer());
                }

                // 2. ENVIAR MENSAJE DE VISTA PREVIA Y ESTADO
                await sock.sendMessage(from, { 
                    text: `Título: **${title}**\n\nDescargando video de Instagram...`,
                    jpegThumbnail: thumbnailBuffer, // Miniatura en el mensaje de espera
                }, { quoted: msg });
                
                // 3. DESCARGA Y ENVÍO DEL VIDEO REAL
                const videoBuffer = await fetch(igData.url).then(res => res.buffer());
                fs.writeFileSync(videoPath, videoBuffer);
                
                await sock.sendMessage(from, { 
                    video: fs.readFileSync(videoPath), 
                    mimetype: 'video/mp4',
                    caption: `✅ **${title}**`, 
                    jpegThumbnail: thumbnailBuffer // Miniatura en el mensaje final
                });
                
                fs.unlinkSync(videoPath); 
            } catch(e){ 
                console.error(e); 
                await sock.sendMessage(from, { text: '❌ Error al descargar IG (post, reel o IGTV). Asegúrate de que el post sea público.' }, { quoted: msg }); 
            }
        }
      }
    } catch(e) { console.error('messages.upsert error', e); }
  });


  // --- MANEJO DE RESPUESTAS DE BOTONES (PLAY) ---
  sock.ev.on('messages.upsert', async (msgUp) => {
    try {
        if (msgUp.type !== 'notify') return;
        for (const msg of msgUp.messages) {
            // Verifica si es una respuesta a un mensaje de botones
            if (msg.message?.buttonsResponseMessage?.selectedButtonId) {
                const selectedId = msg.message.buttonsResponseMessage.selectedButtonId;
                const parentMsgId = msg.message.buttonsResponseMessage.contextInfo.stanzaId;
                const info = pending.get(parentMsgId);

                if (!info) return; // No encontramos la info de la solicitud

                const from = info.from;
                const videoId = info.videoId;
                const title = info.title;
                const videoPath = info.videoPath;
                const audioPath = info.audioPath;
                const thumbnailBuffer = info.thumbnailBuffer; // Recuperamos el buffer

                pending.delete(parentMsgId); // Eliminamos la solicitud pendiente

                if (selectedId.startsWith('send_video_')) {
                    // Descargar y enviar video (tmp-yt-*.mp4)
                    await sock.sendMessage(from, { text: `Descargando video: **${title}** (esto puede tardar...)` }, { quoted: msg });
                    
                    ytdl(`https://www.youtube.com/watch?v=${videoId}`, { filter: 'audioandvideo', quality: 'highest' })
                        .pipe(fs.createWriteStream(videoPath)) 
                        .on('finish', async () => {
                            await sock.sendMessage(from, { 
                                video: fs.readFileSync(videoPath), 
                                mimetype: 'video/mp4', 
                                caption: `✅ Video: **${title}**`,
                                jpegThumbnail: thumbnailBuffer // Miniatura en el envío final
                            });
                            fs.unlinkSync(videoPath); 
                        })
                        .on('error', (err) => {
                            console.error('Error al descargar video:', err);
                            sock.sendMessage(from, { text: '❌ Error al descargar el video.' });
                        });

                } else if (selectedId.startsWith('send_audio_')) {
                    // Descargar, convertir y enviar audio (tmp-yt-*.mp3)
                    await sock.sendMessage(from, { text: `Descargando y convirtiendo audio: **${title}**` }, { quoted: msg });

                    const stream = ytdl(`https://www.youtube.com/watch?v=${videoId}`, { filter: 'audioonly', quality: 'highestaudio' });
                    
                    ffmpeg(stream)
                        .audioBitrate(128)
                        .save(audioPath)
                        .on('end', async () => {
                            await sock.sendMessage(from, { 
                                audio: fs.readFileSync(audioPath), 
                                mimetype: 'audio/mp4', 
                                caption: `✅ Audio: **${title}**`,
                                jpegThumbnail: thumbnailBuffer // Miniatura en el envío final
                            });
                            fs.unlinkSync(audioPath); 
                        })
                        .on('error', (err) => {
                            console.error('Error al convertir audio:', err);
                            sock.sendMessage(from, { text: '❌ Error al convertir el audio.' });
                        });
                }
            }
        }
    } catch(e) { console.error('messages.upsert (button) error', e); }
  });
}

function getTextFromMessage(message) {
  return message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || message.buttonsResponseMessage?.selectedButtonId || null;
}

// EXPORTAMOS la función startBot para que QR.js la pueda llamar 
module.exports = { startBot };