import {parseChunk, makeWarn} from './chunk_parser.js';

export function parseStr(buf) {
	console.assert(buf instanceof Uint8Array);
	return {rawString: buf};
}

export function parseCtab(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'Ctab');
	if (buf.byteLength < 27) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const content = {
		sourceCh:               buf[0],
		voiceName:              String.fromCharCode(...buf.subarray(1, 1 + 8)),
		destinationCh:          buf[9],
		editable:               buf[10],
		noteMute:               buf.slice(11, 11 + 2),
		chordMute:              buf.slice(13, 13 + 5),
		sourceChord:            buf[18],
		chordType:              buf[19],
		noteTranspositionRule:  buf[20],
		noteTranspositionTable: buf[21],
		highKey:                buf[22],
		noteLimitLow:           buf[23],
		noteLimitHigh:          buf[24],
		retriggerRule:          buf[25],
		specialFeatureId:       buf[26],
	};
	if (content.specialFeatureId !== 0x00 && buf.byteLength >= 31) {
		content.specialFeatures = buf.slice(27, 27 + 4);
	}

	return content;
}

export function parseCtb2(buf, tag, parentTags, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'Ctb2');
	if (buf.byteLength < 47) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const [payload, payloadSub] = divideBuf(buf, 47);
	const content = {
		sourceCh:            payload[0],
		voiceName:           String.fromCharCode(...payload.subarray(1, 1 + 8)),
		destinationCh:       payload[9],
		editable:            payload[10],
		noteMute:            payload.slice(11, 11 + 2),
		chordMute:           payload.slice(13, 13 + 5),
		sourceChord:         payload[18],
		chordType:           payload[19],
		middleNoteLimitLow:  payload[20],
		middleNoteLimitHigh: payload[21],
		parts: [...new Array(3)].map((_, i) => ({
			noteTranspositionRule:  payload[22 + 6 * i],
			noteTranspositionTable: payload[23 + 6 * i],
			highKey:                payload[24 + 6 * i],
			noteLimitLow:           payload[25 + 6 * i],
			noteLimitHigh:          payload[26 + 6 * i],
			retriggerRule:          payload[27 + 6 * i],
		})),
		unknownBytes: payload.slice(40, 40 + 7),
	};

	// Parses the following 'Cntt' chunks.
	const tags = [...parentTags, tag];
	const subChunks = parseChunk(payloadSub, tags, logs);

	return [
		{tag, tags, payload, content},
		...subChunks,
	];
}

export function parseCntt(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'Cntt');
	if (buf.byteLength !== 2) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	return {
		sourceCh:               buf[0],
		noteTranspositionTable: buf[1],
	};
}

export function parseFnrp(buf, tag, parentTags, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'FNRP');
	if (buf.byteLength < 5) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const [payload, payloadSub] = divideBuf(buf, 5);
	const content = {
		usecPerBeat: (payload[0] << 16) | (payload[1] << 8) | payload[2],
		numerator:   payload[3],
		denominator: payload[4],
	};

	// Parses the following 'Mnam', 'Gnam', 'Kwd1', and 'Kwd2' chunks.
	const tags = [...parentTags, tag];
	const subChunks = parseChunk(payloadSub, tags, logs);

	return [
		{tag, tags, payload, content},
		...subChunks,
	];
}

function divideBuf(buf, offset) {
	console.assert(buf instanceof Uint8Array);
	console.assert(0 <= offset && offset <= buf.byteLength);

	return [buf.subarray(0, offset), buf.subarray(offset)];
}

// See http://www.jososoft.dk/yamaha/articles.htm for the definitions of each field.
