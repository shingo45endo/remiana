import {makeWarn} from './chunk_parser.js';

// colh: Collection Header Chunk
export function parseColh(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'colh');
	if (buf.byteLength !== 4) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		cInstruments: view.getUint16(0, true),
	};
}

// dlid: DLSID Chunk
export function parseDlid(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'dlid');
	if (buf.byteLength !== 16) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		ulData1: view.getUint32(0, true),
		usData2: view.getUint16(4, true),
		usData3: view.getUint16(6, true),
		abData4: buf.slice(8, 16),
	};
}

// cdl: Conditional Chunk
export function parseCdl(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'cdl ');
	if (buf.byteLength < 2) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const operations = [];
	let index = 0;
loop_opcode:
	while (index < buf.byteLength) {
		const opcode = view.getUint16(index, true);
		index += 2;

		switch (opcode) {
		case 0x0001:	// DLS_CDL_AND
		case 0x0002:	// DLS_CDL_OR
		case 0x0003:	// DLS_CDL_XOR
		case 0x0004:	// DLS_CDL_ADD
		case 0x0005:	// DLS_CDL_SUBTRACT
		case 0x0006:	// DLS_CDL_MULTIPLY
		case 0x0007:	// DLS_CDL_DIVIDE
		case 0x0008:	// DLS_CDL_LOGICAL_AND
		case 0x0009:	// DLS_CDL_LOGICAL_OR
		case 0x000a:	// DLS_CDL_LT
		case 0x000b:	// DLS_CDL_LE
		case 0x000c:	// DLS_CDL_GT
		case 0x000d:	// DLS_CDL_GE
		case 0x000e:	// DLS_CDL_EQ
		case 0x000f:	// DLS_CDL_NOT
			operations.push({opcode});
			break;

		case 0x0010:	// DLS_CDL_CONST
			if (index + 4 < buf.byteLength) {
				const constant = view.getUint32(index, true);
				index += 4;
				operations.push({opcode, constant});
			} else {
				logs.push(makeWarn(`Not enough '${tag}' size for constant`, buf.subarray(index)));
				break loop_opcode;
			}
			break;

		case 0x0011:	// DLS_CDL_QUERY
		case 0x0012:	// DLS_CDL_QUERYSUPPORTED
			if (index + 16 < buf.byteLength) {
				const query = {
					ulData1: view.getUint32(index, true),
					usData2: view.getUint16(index + 4, true),
					usData3: view.getUint16(index + 6, true),
					abData4: buf.slice(index + 8, 16),
				};
				index += 16;
				operations.push({opcode, query});
			} else {
				logs.push(makeWarn(`Not enough '${tag}' size for query`, buf.subarray(index)));
				break loop_opcode;
			}
			break;

		default:
			logs.push(makeWarn(`Invalid opcode in '${tag}' chunk`, buf));
			break loop_opcode;
		}
	}

	if (index !== buf.byteLength) {
		console.assert(index < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'`, buf.subarray(index)));
	}

	return {operations};
}

// insh: Instrument Header Chunk
export function parseInsh(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'insh');
	if (buf.byteLength !== 12) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		cRegions:           view.getUint32(0, true),
		ulBankLocale:       view.getUint32(4, true),
		ulInstrumentLocale: view.getUint32(8, true),
	};
}

// rgnh: Region Header Chunk
export function parseRgnh(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'rgnh');
	if (buf.byteLength < 12) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		usLowRangeKey:       view.getUint16(0, true),
		usHighRangeKey:      view.getUint16(2, true),
		usLowRangeVelocity:  view.getUint16(4, true),
		usHighRangeVelocity: view.getUint16(6, true),
		fusOptions:          view.getUint16(8, true),
		usKeyGroup:          view.getUint16(10, true),
	};
	if (buf.byteLength >= 14) {
		content.usLayer = view.getUint16(12, true);
	}

	return content;
}

// art1: Level 1 Articulator Chunk
// art2: Level 2 Articulator Chunk
export function parseArt(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'art1' || tag === 'art2');
	if (buf.byteLength < 8) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		cbSize:            view.getUint32(0, true),
		cConnectionBlocks: view.getUint32(4, true),
		connectionBlocks:  [],
	};
	const begin = 8;
	const end = begin + 12 * content.cConnectionBlocks;
	if (buf.byteLength >= end) {
		for (let index = begin; index < end; index += 12) {
			content.connectionBlocks.push({
				usSource:      view.getUint16(index, true),
				usControl:     view.getUint16(index + 2, true),
				usDestination: view.getUint16(index + 4, true),
				usTransform:   view.getUint16(index + 6, true),
				lScale:        view.getInt32(index + 8, true),
			});
		}
	}

	if (end !== buf.byteLength) {
		console.assert(end < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'`, buf.subarray(end)));
	}

	return content;
}

// wlnk: Wave Link Chunk
export function parseWlnk(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'wlnk');
	if (buf.byteLength !== 12) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		fusOptions:   view.getUint16(0, true),
		usPhaseGroup: view.getUint16(2, true),
		ulChannel:    view.getUint32(4, true),
		ulTableIndex: view.getUint32(8, true),
	};
}

// wsmp: Wave Sample Chunk
export function parseWsmp(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'wsmp');
	if (buf.byteLength < 8) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		cbSize:          view.getUint32(0, true),
		usUnityNote:     view.getUint16(4, true),
		sFineTune:       view.getInt16(6, true),
		lGain:           view.getInt32(8, true),
		fulOptions:      view.getUint32(12, true),
		cSampleLoops:    view.getUint32(16, true),
		wavesampleLoops: [],
	};
	const begin = 20;
	const end = begin + 16 * content.cSampleLoops;
	if (buf.byteLength >= end) {
		for (let index = begin; index < end; index += 16) {
			content.wavesampleLoops.push({
				cbSize:       view.getUint32(index, true),
				ulLoopType:   view.getUint32(index + 4, true),
				ulLoopStart:  view.getUint32(index + 8, true),
				ulLoopLength: view.getUint32(index + 12, true),
			});
		}
	}

	if (end !== buf.byteLength) {
		console.assert(end < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'`, buf.subarray(end)));
	}

	return content;
}

// ptbl: Pool Table Chunk
export function parsePtbl(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'ptbl');
	if (buf.byteLength < 8) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		cbSize:   view.getUint32(0, true),
		cCues:    view.getUint32(4, true),
		poolcues: [],
	};
	const begin = 8;
	const end = begin + 4 * content.cCues;
	if (buf.byteLength >= end) {
		for (let index = begin; index < end; index += 4) {
			content.poolcues.push({
				ulOffset: view.getUint32(index, true),
			});
		}
	}

	if (end !== buf.byteLength) {
		console.assert(end < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'`, buf.subarray(end)));
	}

	return content;
}

// vers: Version Chunk
export function parseVers(buf, tag, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'vers');
	if (buf.byteLength !== 8) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		dwVersionMS: view.getUint32(0, true),
		dwVersionLS: view.getUint32(4, true),
	};
}
