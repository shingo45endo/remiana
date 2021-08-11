import {parseMThd, parseMTrk} from './chunk_parser_smf.js';
import {parseStr, parseCtab, parseCtb2, parseFnrp, parseCntt} from './chunk_parser_ysf.js';
import {parseZstr, parseDisp, parseData} from './chunk_parser_riff.js';
import {parseFmt, parseFact, parseCue, parsePlst, parseLablNote, parseLtxt, parseInst, parseSmpl} from './chunk_parser_wave.js';
import {parseColh, parseDlid, parseCdl, parseInsh, parseRgnh, parseArt, parseWlnk, parseWsmp, parsePtbl, parseVers} from './chunk_parser_dls.js';
import {parseV000} from './chunk_parser_m2a.js';

const fourCCs = Object.freeze({
	// Standard MIDI File
	'MThd': {isBigEndian: true},
	'MTrk': {isBigEndian: true},

	// YAMAHA XF Format
	'XFIH': {isBigEndian: true},
	'XFKM': {isBigEndian: true},

	// YAMAHA Style File
	'CASM': {isBigEndian: true, isContainer: true},
	'CSEG': {isBigEndian: true, isContainer: true},
	'Sdec': {isBigEndian: true},
	'Ctab': {isBigEndian: true},
	'Ctb2': {isBigEndian: true},
	'Cntt': {isBigEndian: true},
	'OTSc': {isBigEndian: true, isContainer: true},
	'FNRc': {isBigEndian: true, isContainer: true},
	'FNRP': {isBigEndian: true},
	'Mnam': {isBigEndian: true},
	'Gnam': {isBigEndian: true},
	'Kwd1': {isBigEndian: true},
	'Kwd2': {isBigEndian: true},
	'MHhd': {isBigEndian: true},
	'MHtr': {isBigEndian: true},

	'CdS1': {isBigEndian: true},

	'NZem': {isBigEndian: true},

	// YAMAHA XG Works
	'S4WH': {isBigEndian: true},
	'S4WB': {isBigEndian: true},
	'S4WT': {isBigEndian: true},
	'S4ST': {isBigEndian: true},
	'SCRS': {isBigEndian: true},
	'SCRA': {isBigEndian: true},
	'SCRD': {isBigEndian: true},

	// RIFF Format
	'RIFF': {isContainer: true},
	'LIST': {isContainer: true},
});
console.assert(Object.keys(fourCCs).every((e) => isValidFourCC(e)));

const chunkHandlers = Object.freeze({
	// Standard MIDI File
	'MThd': parseMThd,
	'MTrk': parseMTrk,

	// YAMAHA XF Format
	'XFIH': parseMTrk,
	'XFKM': parseMTrk,

	// YAMAHA Style File
	'Sdec': parseStr,
	'Ctab': parseCtab,
	'Ctb2': parseCtb2,
	'Cntt': parseCntt,
	'FNRP': parseFnrp,
	'Mnam': parseStr,
	'Gnam': parseStr,
	'Kwd1': parseStr,
	'Kwd2': parseStr,

	'NZem': parseMTrk,

	// RIFF Format
	'IARL': parseZstr,
	'IART': parseZstr,
	'ICMS': parseZstr,
	'ICMT': parseZstr,
	'ICOP': parseZstr,
	'ICRD': parseZstr,
	'ICRP': parseZstr,
	'IDIM': parseZstr,
	'IDPI': parseZstr,
	'IENG': parseZstr,
	'IGNR': parseZstr,
	'IKEY': parseZstr,
	'ILGT': parseZstr,
	'ILNG': parseZstr,
	'IMED': parseZstr,
	'INAM': parseZstr,
	'IPLT': parseZstr,
	'IPRD': parseZstr,
	'IPRT': parseZstr,
	'ISBJ': parseZstr,
	'ISFT': parseZstr,
	'ISHP': parseZstr,
	'ISRC': parseZstr,
	'ISRF': parseZstr,
	'ITCH': parseZstr,

	'ISMP': parseZstr,
	'IDIT': parseZstr,
	'ITRK': parseZstr,
	'ITOC': parseZstr,

	'DISP': parseDisp,
//	'JUNK': null,
//	'PAD ': null,

	'data': parseData,

	// Wave
	'fmt ': parseFmt,
	'fact': parseFact,
	'cue ': parseCue,
	'plst': parsePlst,
	'labl': parseLablNote,
	'note': parseLablNote,
	'ltxt': parseLtxt,
	'inst': parseInst,
	'smpl': parseSmpl,

	// DLS
	'colh': parseColh,
	'dlid': parseDlid,
	'cdl ': parseCdl,
	'insh': parseInsh,
	'rgnh': parseRgnh,
	'art1': parseArt,
	'art2': parseArt,
	'wlnk': parseWlnk,
	'wsmp': parseWsmp,
	'ptbl': parsePtbl,
	'vers': parseVers,

	// YAMAHA MU Sampling Extension
	'v000': parseV000,

	// YAMAHA XG Works
	'S4WB': parseMTrk,
});
console.assert(Object.keys(chunkHandlers).every((e) => isValidFourCC(e)));

export function parseChunk(buf, parentTags = [], logs = []) {
	console.assert(buf instanceof Uint8Array);

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

	const chunks = [];
	let index = 0;
	while (index + 8 <= buf.byteLength) {
		// Reads a tag.
		const tag = String.fromCharCode(...buf.subarray(index, index + 4));
		if (!isValidFourCC(tag)) {
			logs.push(makeWarn('Invalid tag', buf.subarray(index, index + 4)));
			break;
		}
		index += 4;

		// Gets the properties of this kind of chunk.
		const {isContainer, isBigEndian} = fourCCs[tag] || {};

		// Reads the length of the chunk.
		let len = view.getUint32(index, !isBigEndian);
		index += 4;
		if (index + len > buf.byteLength) {
			logs.push(makeWarn(`Not enough chunk size for '${tag}'`, buf.subarray(index - 8)));

			// If the tag (chunk) is well-known, continues parsing with truncated chunk.
			if (Object.keys(chunkHandlers).includes(tag) || Object.keys(fourCCs).includes(tag)) {
				len = buf.byteLength - index;
				logs.push(makeWarn(`Truncated the '${tag}' chunk (It may be incomplete)`));
			} else {
				index -= 8;
				break;
			}
		}

		// Parses the chunk.
		if (isContainer) {
			if (!isBigEndian) {	// RIFF container
				console.assert(tag === 'RIFF' || tag === 'LIST');

				// Reads the type of RIFF or LIST chunk.
				const type = String.fromCharCode(...buf.subarray(index, index + 4));
				if (!isValidFourCC(type)) {
					logs.push(makeWarn('Invalid RIFF type', buf.subarray(index, index + 4)));
					break;
				}
				index += 4;

				// Adds the payload as container.
				chunks.push({tag: type, tags: [...parentTags, type], payload: buf.subarray(index, index + len - 4)});

				// Parses the payload as chunk.
				const subChunks = parseChunk(buf.subarray(index, index + len - 4), [...parentTags, type], logs);
				console.assert(Array.isArray(subChunks));
				chunks.push(...subChunks);
				index += ceiling2(len) - 4;

			} else {	// YAMAHA Style File container
				// Adds the payload as container.
				chunks.push({tag, tags: [...parentTags, tag], payload: buf.subarray(index, index + len)});

				// Parses the payload as chunk.
				const subChunks = parseChunk(buf.subarray(index, index + len), [...parentTags, tag], logs);
				console.assert(Array.isArray(subChunks));
				chunks.push(...subChunks);
				index += len;
			}

		} else {
			// Parses the payload as chunk.
			const payload = buf.subarray(index, index + len);
			const chunk = parseContentsChunk(payload, tag, parentTags, logs);
			if (Array.isArray(chunk)) {	// Array means chunks.
				chunks.push(...chunk);
			} else {	// Object means content.
				console.assert(chunk && typeof chunk === 'object');
				chunks.push({tag, tags: [...parentTags, tag], payload, content: chunk});
			}
			index += (isBigEndian) ? len : ceiling2(len);
		}
	}

	// Checks whether the buffer ends without any leftovers or not.
	if (index < buf.byteLength) {
		const tag = '$Garbage$';
		const payload = buf.subarray(index);
		chunks.push({tag, tags: [...parentTags, tag], payload});

		logs.push(makeWarn(`Garbage in ${(parentTags.length === 0) ? 'the file' : `${parentTags[parentTags.length - 1]}`}`, payload));
	}

	return chunks;

	function ceiling2(num) {
		return Math.trunc((num + 1) / 2) * 2;
	}
}

function isValidFourCC(str) {
	return typeof str === 'string' && /^[\x20-\x7e]{4}$/u.test(str);
}

function parseContentsChunk(buf, tag, parentTags = [], logs = []) {
	console.assert(isValidFourCC(tag));
	console.assert(buf instanceof Uint8Array);
	console.assert(parentTags.every((e) => isValidFourCC(e)));

	const handler = chunkHandlers[tag];
	if (handler) {
		const chunk = handler(buf, tag, parentTags, logs);
		if (Array.isArray(chunk)) {
			return chunk;
		} else {
			return {...chunk};
		}
	} else {
		return {};
	}
}

export function makeError(message, info) {
	console.assert(typeof message === 'string');

	const error = new Error(message);
	error.name = 'MidiFileParseError';
	if (info) {
		error.info = info;
	}

	return error;
}

export function makeWarn(message, info) {
	console.assert(typeof message === 'string');

	if (info && info instanceof Uint8Array) {
		if (info.byteLength > 0) {
			const strBytes = [...info.subarray(0, 8)].map((e) => `${e.toString(16).padStart(2, '0')}`).join(' ');
			message += ` [${strBytes}${(info.byteLength > 8) ? ` ... (total ${info.byteLength} bytes)` : ''}]`;
		}
		message += ` at 0x${(info.byteOffset).toString(16).padStart(6, '0')}`;
	}

//	console.warn(message);

	return {message, info};
}
