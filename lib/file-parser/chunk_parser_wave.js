import {makeWarn} from './chunk_parser.js';

// fmt: Format Chunk
export function parseFmt(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'fmt ');
	if (buf.byteLength < 16) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		wFormatTag:      view.getUint16(0, true),
		nChannels:       view.getUint16(2, true),
		nSamplesPerSec:  view.getUint32(4, true),
		nAvgBytesPerSec: view.getUint32(8, true),
		nBlockAlign:     view.getUint16(12, true),
		wBitsPerSample:  view.getUint16(14, true),
	};
	if (buf.byteLength >= 18) {
		content.cbSize     = view.getUint16(16, true);
		content.extraBytes = buf.subarray(18, 18 + content.cbSize);
	}

	return content;
}

// fact: Fact Chunk
export function parseFact(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'fact');
	if (buf.byteLength < 4) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		dwSampleLength: view.getUint32(0, true),
	};
}

// cue: Cue Points Chunk
export function parseCue(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'cue ');
	if (buf.byteLength < 24) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		dwCuePoints: view.getUint32(0, true),
		cuePoints:   [],
	};
	const begin = 4;
	const end = begin + 24 * content.dwCuePoints;
	if (buf.byteLength >= end) {
		for (let index = begin; index < end; index += 24) {
			content.cuePoints.push({
				dwName:         view.getUint32(index, true),
				dwPosition:     view.getUint32(index + 4, true),
				fccChunk:       String.fromCharCode(...buf.subarray(index + 8, index + 8 + 4)),
				dwChunkStart:   view.getUint32(index + 12, true),
				dwBlockStart:   view.getUint32(index + 16, true),
				dwSampleOffset: view.getUint32(index + 20, true),
			});
		}
	}

	if (end !== buf.byteLength) {
		console.assert(end < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'`, buf.subarray(end)));
	}

	return content;
}

// plst: Playlist Chunk
export function parsePlst(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'plst');
	if (buf.byteLength < 4) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		dwSegments:   view.getUint32(0, true),
		playSegments: [],
	};
	const begin = 4;
	const end = begin + 12 * content.dwSegments;
	if (buf.byteLength >= end) {
		for (let index = begin; index < end; index += 12) {
			content.playSegments.push({
				dwName:   view.getUint32(index, true),
				dwLength: view.getUint32(index + 4, true),
				dwLoops:  view.getUint32(index + 8, true),
			});
		}
	}

	if (end !== buf.byteLength) {
		console.assert(end < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'`, buf.subarray(end)));
	}

	return content;
}

// labl: Associated Data Chunk (Label Information)
// note: Associated Data Chunk (Note Information)
export function parseLablNote(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'labl' || tag === 'note');
	if (buf.byteLength < 5) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const data = buf.subarray(4);
	const len = [...data].findIndex((e) => (e === 0x00));
	if (len < 0) {
		logs.push(makeWarn(`ZSTR in '${tag}' not terminated by zero`, buf));
	}
	return {
		dwName:    view.getUint32(0, true),
		rawString: data.slice(0, (len >= 0) ? len : data.byteLength),
	};
}

// ltxt: Associated Data Chunk (Text with Data Length Information)
export function parseLtxt(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'ltxt');
	if (buf.byteLength < 20) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		dwName:         view.getUint32(0, true),
		dwSampleLength: view.getUint32(4, true),
		dwPurpose:      view.getUint32(8, true),
		wCountry:       view.getUint16(12, true),
		wLanguage:      view.getUint16(14, true),
		wDialect:       view.getUint16(16, true),
		wCodePage:      view.getUint16(18, true),
	};
}

// inst: Instrument Chunk
export function parseInst(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'inst');
	if (buf.byteLength < 7) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	return {
		bUnshiftedNote: view.getUint8(0),
		chFineTune:     view.getInt8(1),
		chGain:         view.getInt8(2),
		bLowNote:       view.getUint8(3),
		bHighNote:      view.getUint8(4),
		bLowVelocity:   view.getUint8(5),
		bHighVelocity:  view.getUint8(6),
	};
}

// smpl: Sample Chunk
export function parseSmpl(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'smpl');
	if (buf.byteLength < 36) {
		logs.push(makeWarn(`Invalid '${tag}' chunk`, buf));
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		dwManufacturer:      view.getUint32(0, true),
		dwProduct:           view.getUint32(4, true),
		dwSamplePeriod:      view.getUint32(8, true),
		dwMIDIUnityNote:     view.getUint32(12, true),
		dwMIDIPitchFraction: view.getUint32(16, true),
		dwSMPTEFormat:       view.getUint32(20, true),
		dwSMPTEOffset:       view.getUint32(24, true),
		cSampleLoops:        view.getUint32(28, true),
		cbSamplerData:       view.getUint32(32, true),
		sampleLoops:         [],
	};

	let index = 36;
	const end = index + 24 * content.cSampleLoops;
	if (buf.byteLength >= end) {
		for (; index < end; index += 24) {
			content.sampleLoops.push({
				dwIdentifier: view.getUint32(index, true),
				dwType:       view.getUint32(index + 4, true),
				dwStart:      view.getUint32(index + 8, true),
				dwEnd:        view.getUint32(index + 12, true),
				dwFraction:   view.getUint32(index + 16, true),
				dwPlayCount:  view.getUint32(index + 20, true),
			});
		}
	}

	if (index + content.cbSamplerData <= buf.byteLength) {
		content.samplerSpecificData = buf.slice(index, index + content.cbSamplerData);
		index += content.cbSamplerData;
	} else {
		logs.push(makeWarn(`Not enough sampler-specific-data size in '${tag}'`, buf.subarray(index)));
		content.samplerSpecificData = new Uint8Array(0);
	}

	if (index !== buf.byteLength) {
		console.assert(index < buf.byteLength);
		logs.push(makeWarn(`Garbage in '${tag}'`, buf.subarray(index)));
	}

	return content;
}
