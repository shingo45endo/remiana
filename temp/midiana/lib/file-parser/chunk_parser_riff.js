import {parseChunk, makeWarn} from './chunk_parser.js';

// Chunks for zero terminated string
export function parseZstr(buf, tag, _, logs = []) {
	console.assert(buf instanceof Uint8Array);
	const len = [...buf].findIndex((e) => (e === 0x00));
	if (len < 0) {
		logs.push(makeWarn(`ZSTR in '${tag}' not terminated by zero`, buf));
	}

	return {rawString: buf.slice(0, (len >= 0) ? len : buf.byteLength)};
}

// disp: Display Chunk
export function parseDisp(buf, tag) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'DISP');

	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const content = {
		type:    view.getUint32(0, true),
		rawData: buf.slice(4),
	};

	switch (content.type) {
	case 0x0001:	// CF_TEXT
		content.rawString = content.rawData.slice(0, content.rawData.byteLength - 1);
		break;

	case 0x0008:	// CF_DIB
		if (content.rawData.byteLength >= 40) {
			const view = new DataView(content.rawData.buffer, content.rawData.byteOffset, content.rawData.byteLength);
			content.bitmapInfo = {
				biSize:          view.getUint32(0, true),
				biWidth:         view.getInt32(4, true),
				biHeight:        view.getInt32(8, true),
				biPlanes:        view.getUint16(12, true),
				biBitCount:      view.getUint16(14, true),
				biCompression:   view.getUint32(16, true),
				biSizeImage:     view.getUint32(20, true),
				biXPelsPerMeter: view.getInt32(24, true),
				biYPelsPerMeter: view.getInt32(28, true),
				biClrUsed:       view.getUint32(32, true),
				biClrImportant:  view.getUint32(36, true),
			};
		}
		break;

	// no default
	}

	return content;
}

// data: Data Chunk
export function parseData(buf, tag, parentTags = [], logs = []) {
	console.assert(buf instanceof Uint8Array);
	console.assert(tag === 'data');

	const tagPath = parentTags.join('/');
	if (tagPath.endsWith('RMID')) {
		const chunks = parseChunk(buf, [...parentTags, tag], logs);
		return [
			{tag, tags: [...parentTags, tag], payload: buf},
			...chunks,
		];
	}

	return null;
}
