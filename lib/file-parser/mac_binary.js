export function isMacBinary(buf) {
	console.assert(buf instanceof Uint8Array);
	if (buf.byteLength < 128) {
		return false;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, 128);

	const fileNameLength = view.getUint8(1);
	return view.getUint8(0) === 0 && view.getUint8(74) === 0 &&
			(1 <= fileNameLength && fileNameLength < 64) &&
			buf.subarray(108, 116).every((e) => (e === 0x00)) &&
			view.getUint32(83) < 0x800000 &&
			view.getUint32(87) < 0x800000;
}

export function parseMacBinary(buf) {
	console.assert(buf instanceof Uint8Array);
	if (!isMacBinary(buf)) {
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, 128);
	const fileNameLength = view.getUint8(1);
	const content = {
		fileNameLength,
		fileNameRaw:         buf.slice(2, 2 + fileNameLength),
		fileType:            String.fromCharCode(...buf.subarray(65, 65 + 4)),
		fileCreator:         String.fromCharCode(...buf.subarray(69, 69 + 4)),
		dataForkLength:      view.getUint32(83),
		resourceForkLength:  view.getUint32(87),
		creationDateRaw:     view.getUint32(91),
		lastModifiedDateRaw: view.getUint32(95),
	};

	content.creationDate     = new Date((content.creationDateRaw     - 2082844800) * 1000);
	content.lastModifiedDate = new Date((content.lastModifiedDateRaw - 2082844800) * 1000);

	return content;
}

export function extractDataFork(buf) {
	console.assert(buf instanceof Uint8Array);
	if (!isMacBinary(buf)) {
		return null;
	}

	const view = new DataView(buf.buffer, buf.byteOffset, 128);
	const dataForkLength = view.getUint32(83);
	if (128 + dataForkLength > buf.byteLength) {
		return null;
	}

	return buf.subarray(128, 128 + dataForkLength);
}
