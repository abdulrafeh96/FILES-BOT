import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    jidNormalizedUser
} from "@whiskeysockets/baileys";

import { google } from "googleapis";
import P from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import path from "path";
import { exec } from "child_process";
import fs from "fs";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== GOOGLE DRIVE CONFIG =====
const DRIVE_API_KEY = "AIzaSyBS3_R-QolPsRYDtg3r2oQAywrqYd9amC4"; 
const DRIVE_FOLDER_ID = "1gSVhMnuw4rQYtXZ8XgAThnG9FaESCVPR"; 
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const STUDENTS_GROUP_LINK = "https://chat.whatsapp.com/DWDY0Fw7wod3WGeNVoaqRB";
const COMMAND_PREFIX = "!";
const FILES_PER_SUBJECT_LIMIT = 3;

const drive = google.drive({
    version: "v3",
    auth: DRIVE_API_KEY
});

const TERM_FILES_DEBUG = true;
const termFileMoreOffsets = new Map();

function debugTermFiles(...args) {
    if (!TERM_FILES_DEBUG) return;
    console.log("[TERM_FILES_DEBUG]", ...args);
}

// ===== FIND HANDOUT =====
function escapeDriveQueryValue(value = "") {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function normalizeLookupText(value = "") {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getSubjectCodes(text = "") {
    const matches = text.match(/[a-zA-Z]{2,4}\d{3}/g) || [];
    return [...new Set(matches.map((match) => match.toUpperCase()))];
}

function buildMoreFilesCommand(termType, subject) {
    return `${COMMAND_PREFIX}more files ${termType} ${subject}`;
}

function getTermFilesOffsetKey(sender, termType, subject) {
    return `${sender}|${termType}|${subject}`;
}

function buildMoreFilesHints(moreSubjects = [], termType) {
    if (moreSubjects.length === 0) return [];

    return [
        "",
        "Need more files? Send this command:",
        ...moreSubjects.map((subject) => `➡️ ${buildMoreFilesCommand(termType, subject)}`)
    ];
}

function isMoreFilesRequest(text = "") {
    return new RegExp(`^\\s*\\${COMMAND_PREFIX}?\\s*more\\s+files\\b`, "i").test(text);
}

function detectTermType(text = "") {
    const normalized = normalizeLookupText(text);

    if (/\b(mid(?: term)?|mid-term|midterm)\b/.test(normalized)) return "mid";
    if (/\b(final(?: term)?|final-term|finalterm)\b/.test(normalized)) return "final";

    return null;
}

function getTermFolderKeywords(termType) {
    if (termType === "mid") {
        return ["mid term", "midterm", "mid-term", "mid terms"];
    }

    if (termType === "final") {
        return ["final term", "finalterm", "final-term", "final terms"];
    }

    return [];
}

function buildSupportFooter() {
    return [
        "━━━━━━━━━━━━━━",
        "Students Support Group",
        STUDENTS_GROUP_LINK
    ].join("\n");
}

function getMentionTag(jid = "") {
    return jid ? `@${jid.split("@")[0]}` : "";
}

function getReportMentions(mentionJid) {
    return mentionJid ? [mentionJid] : [];
}

function buildRequesterLine(requestedBy) {
    return requestedBy ? [`👤  Requested By: *${requestedBy}*`] : [];
}

function buildDeliveryReport({ type, subject, totalSent, moreSubjects = [], termType, requestedBy }) {
    return [
        "╭─〔 *DELIVERY REPORT* 〕",
        "",
        "✅  Status: *Delivered*",
        ...buildRequesterLine(requestedBy),
        `📂  Type: *${type}*`,
        `📚  Subject: *${subject}*`,
        `📦  Total Sent: *${totalSent}*`,
        "",
        "Your files have been delivered.",
        "Please check them. Everything is ready.",
        ...buildMoreFilesHints(moreSubjects, termType),
        "",
        "╰────────────────",
        buildSupportFooter()
    ].join("\n");
}

function buildFileStatusReport({ type, subject, requestedBy }) {
    return [
        "╭─〔 *FILE STATUS* 〕",
        "",
        "⛔  Status: *Not Delivered*",
        ...buildRequesterLine(requestedBy),
        `📂  Type: *${type}*`,
        `📚  Subject: *${subject}*`,
        "",
        "This file is not uploaded to Drive yet.",
        "It will be added soon. Please check back later.",
        "",
        "╰────────────────",
        buildSupportFooter()
    ].join("\n");
}

function buildHandoutsReport({ subject, totalSent, requestedBy }) {
    return [
        "╭─〔 *HANDOUTS DELIVERED* 〕",
        "",
        "✅  Status: *Delivered*",
        ...buildRequesterLine(requestedBy),
        `📘  Subject: *${subject}*`,
        `📦  Handouts Sent: *${totalSent}*`,
        "",
        "Your handouts have been delivered.",
        "Please check them. Everything is ready.",
        "",
        "╰────────────────",
        buildSupportFooter()
    ].join("\n");
}

function buildNoMoreFilesReport({ type, subject, requestedBy }) {
    return [
        "╭─〔 *FILE STATUS* 〕",
        "",
        "✅  Status: *Completed*",
        ...buildRequesterLine(requestedBy),
        `📂  Type: *${type}*`,
        `📚  Subject: *${subject}*`,
        "",
        "No more files are available for this subject.",
        "All available files have already been sent.",
        "",
        "╰────────────────",
        buildSupportFooter()
    ].join("\n");
}

function buildMoreFilesNeedDetailsReport() {
    return [
        "╭─〔 *MORE FILES* 〕",
        "",
        "Please include the term and subject in the command.",
        "",
        `Example: *${buildMoreFilesCommand("mid", "CS101")}*`,
        `Example: *${buildMoreFilesCommand("final", "CS101")}*`,
        "",
        "╰────────────────",
        buildSupportFooter()
    ].join("\n");
}

function buildHandoutsStatusReport({ subject, requestedBy }) {
    return [
        "╭─〔 *HANDOUTS STATUS* 〕",
        "",
        "⛔  Status: *Not Delivered*",
        ...buildRequesterLine(requestedBy),
        `📘  Subject: *${subject}*`,
        "",
        "Handouts are not uploaded to Drive yet.",
        "They will be added soon. Please check back later.",
        "",
        "╰────────────────",
        buildSupportFooter()
    ].join("\n");
}

async function listDriveChildren(parentId, queryParts = []) {
    try {
        const q = [`'${parentId}' in parents`, "trashed = false", ...queryParts].join(" and ");
        const files = [];
        let pageToken;
        let pages = 0;

        do {
            const res = await drive.files.list({
                q,
                pageSize: 1000,
                pageToken,
                fields: "nextPageToken, files(id, name, mimeType)"
            });

            files.push(...(res.data.files || []));
            pageToken = res.data.nextPageToken;
            pages += 1;
        } while (pageToken);

        debugTermFiles("listDriveChildren", {
            parentId,
            queryParts,
            pages,
            itemCount: files.length
        });

        return files;
    } catch (err) {
        console.log("Drive Error:", err);
        return [];
    }
}

async function findDriveFolderByName(parentId, folderNameKeywords) {
    const folders = await listDriveChildren(parentId, [`mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`]);
    const normalizedKeywords = folderNameKeywords.map(normalizeLookupText).filter(Boolean);
    const matchedFolder = folders.find((folder) => {
        const normalizedName = normalizeLookupText(folder.name);
        return normalizedKeywords.some((keyword) => normalizedName.includes(keyword));
    }) || null;

    debugTermFiles("findDriveFolderByName", {
        parentId,
        keywords: folderNameKeywords,
        normalizedKeywords,
        scannedFolders: folders.length,
        sampleFolders: folders.slice(0, 10).map((f) => f.name),
        matchedFolder: matchedFolder ? { id: matchedFolder.id, name: matchedFolder.name } : null
    });

    return matchedFolder;
}

async function findTermSubjectFiles(termType, subject) {
    const termKeywords = getTermFolderKeywords(termType);
    const termFolder = await findDriveFolderByName(DRIVE_FOLDER_ID, termKeywords);
    if (!termFolder?.id) {
        debugTermFiles("findTermSubjectFiles:noTermFolder", {
            termType,
            termKeywords,
            subject
        });
        return [];
    }

    const subjectFolder = await findDriveFolderByName(termFolder.id, [subject]);
    if (!subjectFolder?.id) {
        debugTermFiles("findTermSubjectFiles:noSubjectFolder", {
            termType,
            subject,
            termFolder: { id: termFolder.id, name: termFolder.name }
        });
        return [];
    }

    debugTermFiles("findTermSubjectFiles:matchedFolders", {
        termType,
        subject,
        termFolder: { id: termFolder.id, name: termFolder.name },
        subjectFolder: { id: subjectFolder.id, name: subjectFolder.name }
    });

    const files = await listDriveChildren(subjectFolder.id, [`mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`]);
    debugTermFiles("findTermSubjectFiles:files", {
        termType,
        subject,
        fileCount: files.length,
        files: files.slice(0, 20).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }))
    });

    return files;
}

function isPdfFile(file) {
    return file?.mimeType === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

async function findHandouts(subject) {
    try {
        const res = await listDriveChildren(DRIVE_FOLDER_ID, [
            `mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`,
            `name contains '${escapeDriveQueryValue(subject)}'`
        ]);
        const pdfFiles = res.filter(isPdfFile);

        console.log("Drive Response:", pdfFiles);

        return pdfFiles;

    } catch (err) {
        console.log("Drive Error:", err);
        return [];
    }
}

// ===== START BOT =====
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: "silent" })
    });

    global.currentBotId = state?.creds?.me?.id || global.currentBotId;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
        try {
            if (qr) {
                console.log("\nâš¡ Scan QR:\n");
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === "open") {
                console.log("âœ… BOT ONLINE");
            }

            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`âŒ Connection closed (code: ${statusCode || "unknown"})`);

                if (shouldReconnect) {
                    console.log("ðŸ” Reconnecting in 5 seconds...");
                    setTimeout(() => {
                        startBot().catch(err => {
                            console.log("Reconnect error:", err);
                        });
                    }, 5000);
                }

                if (!shouldReconnect) {
                    console.log("âš ï¸ Session logged out. Delete auth folder and re-scan QR.");
                }
            }
        } catch (err) {
            console.log("Connection handler error:", err);
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg?.message || !msg?.key?.remoteJid) return;
            if (msg.key.fromMe) return;

            const sender = msg.key.remoteJid;

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                msg.message.documentMessage?.caption ||
                "";

            const normalizedText = text.trim();
            const lowerText = normalizedText.toLowerCase();
            const textWithoutUrls = lowerText.replace(/https?:\/\/\S+/g, " ");
            const requesterJid = jidNormalizedUser(msg.key.participant || sender);
            const requesterMention = getMentionTag(requesterJid);
            const reportMentions = getReportMentions(requesterJid);
            console.log("MSG:", normalizedText);

            // ===== TERM FILES / HANDOUTS =====
            try {
                const subjectCodes = getSubjectCodes(lowerText);
                const termType = detectTermType(lowerText);
                const wantsHandouts = /\b(handouts?|highlight(?:ed|s)?\s*handouts?|bookan|kitaaban|kitaban)\b/i.test(textWithoutUrls);
                const wantsMoreFiles = isMoreFilesRequest(lowerText);
                const wantsFiles =
                    wantsMoreFiles ||
                    /\bfiles?\b/i.test(lowerText) ||
                    (!wantsHandouts && /\bsend\b/i.test(lowerText));
                debugTermFiles("incomingTermRequestCheck", {
                    text: normalizedText,
                    termType,
                    subjectCodes,
                    wantsFiles,
                    wantsHandouts,
                    wantsMoreFiles
                });

                if (wantsMoreFiles && (!termType || subjectCodes.length === 0)) {
                    await sock.sendMessage(sender, {
                        text: buildMoreFilesNeedDetailsReport()
                    });
                    if (!wantsHandouts) {
                        return;
                    }
                }

                if (termType && subjectCodes.length > 0 && wantsFiles) {
                    let totalSent = 0;
                    let foundAnyFile = false;
                    const unavailableSubjects = [];
                    const moreSubjects = [];
                    const reportType = `${termType === "mid" ? "Mid Term" : "Final Term"} Files`;

                    for (const subject of subjectCodes) {
                        console.log("Searching term files:", termType, subject);

                        const files = await findTermSubjectFiles(termType, subject);
                        console.log("Term files result:", files);
                        debugTermFiles("termRequestResult", {
                            sender,
                            termType,
                            subject,
                            fileCount: files.length
                        });

                        if (files.length > 0) {
                            const offsetKey = getTermFilesOffsetKey(sender, termType, subject);
                            const startIndex = wantsMoreFiles
                                ? (termFileMoreOffsets.get(offsetKey) || 0)
                                : 0;
                            const filesToSend = files.slice(startIndex, startIndex + FILES_PER_SUBJECT_LIMIT);
                            const nextIndex = startIndex + filesToSend.length;

                            if (filesToSend.length === 0) {
                                unavailableSubjects.push(subject);
                                termFileMoreOffsets.delete(offsetKey);
                                continue;
                            }

                            foundAnyFile = true;
                            if (nextIndex < files.length) {
                                termFileMoreOffsets.set(offsetKey, nextIndex);
                                moreSubjects.push(subject);
                            } else {
                                termFileMoreOffsets.delete(offsetKey);
                            }

                            for (const file of filesToSend) {
                                const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
                                try {
                                    await sock.sendMessage(sender, {
                                        document: { url: downloadUrl },
                                        mimetype: file.mimeType,
                                        fileName: file.name
                                    });
                                    totalSent += 1;
                                    debugTermFiles("sendFile:success", {
                                        sender,
                                        termType,
                                        subject,
                                        fileId: file.id,
                                        fileName: file.name
                                    });
                                } catch (sendErr) {
                                    debugTermFiles("sendFile:error", {
                                        sender,
                                        termType,
                                        subject,
                                        fileId: file.id,
                                        fileName: file.name,
                                        error: sendErr?.message || sendErr
                                    });
                                    unavailableSubjects.push(subject);
                                }
                            }
                        } else {
                            debugTermFiles("termRequest:notFound", {
                                sender,
                                termType,
                                subject
                            });
                            unavailableSubjects.push(subject);
                        }
                    }
                    const subjectLabel = subjectCodes.join(", ");
                    if (foundAnyFile && totalSent > 0) {
                        await sock.sendMessage(sender, {
                            text: buildDeliveryReport({
                                type: reportType,
                                subject: subjectLabel,
                                totalSent,
                                moreSubjects,
                                termType,
                                requestedBy: requesterMention
                            }),
                            mentions: reportMentions
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: wantsMoreFiles
                                ? buildNoMoreFilesReport({
                                    type: reportType,
                                    subject: unavailableSubjects.join(", ") || subjectLabel,
                                    requestedBy: requesterMention
                                })
                                : buildFileStatusReport({
                                    type: reportType,
                                    subject: unavailableSubjects.join(", ") || subjectLabel,
                                    requestedBy: requesterMention
                                }),
                            mentions: reportMentions
                        });
                    }
                    if (!wantsHandouts) {
                        return;
                    }
                }

                if (wantsHandouts) {
                    if (subjectCodes.length === 0) {
                        return;
                    }

                    let totalSent = 0;
                    let foundAnyFile = false;
                    const unavailableSubjects = [];

                    for (const subject of subjectCodes) {
                        console.log("Searching handout:", subject);

                        const files = await findHandouts(subject);
                        console.log("Result:", files);

                        if (files.length > 0) {
                            foundAnyFile = true;
                            for (const file of files) {
                                const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`;
                                await sock.sendMessage(sender, {
                                    document: { url: downloadUrl },
                                    mimetype: file.mimeType,
                                    fileName: file.name
                                });
                                totalSent += 1;
                            }
                        } else {
                            unavailableSubjects.push(subject);
                        }
                    }
                    const subjectLabel = subjectCodes.join(", ");
                    if (foundAnyFile && totalSent > 0) {
                        await sock.sendMessage(sender, {
                            text: buildHandoutsReport({
                                subject: subjectLabel,
                                totalSent,
                                requestedBy: requesterMention
                            }),
                            mentions: reportMentions
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: buildHandoutsStatusReport({
                                subject: unavailableSubjects.join(", ") || subjectLabel,
                                requestedBy: requesterMention
                            }),
                            mentions: reportMentions
                        });
                    }
                    return;
                }
            } catch (err) {
                console.log("File Request Error:", err);
                await sock.sendMessage(sender, {
                    text: "Oops! Something went wrong while fetching your files. Please try again later."
                });
            }

        } catch (err) {
            console.log("Message handler error:", err);
        }
    });
}

startBot();
