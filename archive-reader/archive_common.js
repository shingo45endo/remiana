// Shared helpers for the LZH and zip readers.

const defaultOptions = {
	maxHeaderScanSize: 1024 * 1024,
	isUtf8NameGuessed: true,
	decodeFileName: decodeShiftJis,
	isCrcVerified: true,
};

const byteSourceMarker = Symbol('byteSource');
const defaultChunkSize = 64 * 1024;

let shiftJisDecoder = null;
let utf8Decoder = null;

const crc16Table = makeCrcTable(0xa001, 16);
const crc32Table = makeCrcTable(0xedb88320, 32);

export function makeArchiveError(message) {
	console.assert(typeof message === 'string');

	const error = new Error(message);
	error.name = 'ArchiveError';
	return error;
}

export function normalizeOptions(options) {
	console.assert(typeof options === 'object');

	const normalized = {...defaultOptions, ...options};
	if (!Number.isInteger(normalized.maxHeaderScanSize) || normalized.maxHeaderScanSize < 0) {
		throw makeArchiveError('maxHeaderScanSize must be a non-negative integer');
	}
	if (typeof normalized.decodeFileName !== 'function') {
		throw makeArchiveError('decodeFileName must be a function');
	}
	return normalized;
}

// Returns an object which reads a part of the source: {size, read(offset, length)}.
export function createByteSource(source) {
	if (source?.[byteSourceMarker]) {
		return source;
	}
	if (source instanceof Uint8Array) {
		return createMemorySource(source);
	}
	if (source instanceof ArrayBuffer) {
		return createMemorySource(new Uint8Array(source));
	}
	if (typeof Blob !== 'undefined' && source instanceof Blob) {
		return createBlobSource(source);
	}
	throw makeArchiveError('Unsupported source type');
}

function createMemorySource(bytes) {
	console.assert(bytes instanceof Uint8Array);

	return {
		[byteSourceMarker]: true,
		size: bytes.length,
		read(offset, length) {
			console.assert(Number.isInteger(offset) && offset >= 0 && Number.isInteger(length) && length >= 0);

			return Promise.resolve(bytes.subarray(offset, Math.min(offset + length, bytes.length)));
		},
	};
}

function createBlobSource(blob) {
	console.assert(blob instanceof Blob);

	// Keeps the last chunk to avoid making a slice for every small header read.
	let chunkOffset = -1;
	let chunkBytes = null;

	async function loadChunk(offset) {
		const bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + defaultChunkSize, blob.size)).arrayBuffer());
		chunkOffset = offset;
		chunkBytes = bytes;
	}

	return {
		[byteSourceMarker]: true,
		size: blob.size,
		async read(offset, length) {
			console.assert(Number.isInteger(offset) && offset >= 0 && Number.isInteger(length) && length >= 0);

			const end = Math.min(offset + length, blob.size);
			if (offset >= end) {
				return new Uint8Array(0);
			}

			// Reads a large range directly without caching it.
			if (end - offset > defaultChunkSize) {
				return new Uint8Array(await blob.slice(offset, end).arrayBuffer());
			}

			if (chunkBytes === null || offset < chunkOffset || end > chunkOffset + chunkBytes.length) {
				await loadChunk(offset);
			}
			return chunkBytes.subarray(offset - chunkOffset, end - chunkOffset);
		},
	};
}

export function readUint16(bytes, offset) {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readUint32(bytes, offset) {
	return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function readUint64(bytes, offset) {
	const high = readUint32(bytes, offset + 4);
	if (high > 0x1fffff) {
		throw makeArchiveError('64-bit value is too large');
	}
	return high * 0x100000000 + readUint32(bytes, offset);
}

export function readLatin1(bytes, offset, length) {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

// Converts an MS-DOS timestamp (local time) to a Date. Returns null if the date is not valid.
export function convertDosTimestamp(dosTime, dosDate) {
	console.assert(Number.isInteger(dosTime) && Number.isInteger(dosDate));

	const year = 1980 + (dosDate >> 9);
	const month = (dosDate >> 5) & 0x0f;
	const day = dosDate & 0x1f;
	const hour = dosTime >> 11;
	const minute = (dosTime >> 5) & 0x3f;
	const second = (dosTime & 0x1f) * 2;

	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
		return null;
	}
	return new Date(year, month - 1, day, hour, minute, second);
}

export function convertUnixTimestamp(seconds) {
	console.assert(Number.isInteger(seconds));

	return (seconds > 0) ? new Date(seconds * 1000) : null;
}

function decodeShiftJis(bytes) {
	console.assert(bytes instanceof Uint8Array);

	// Creates the decoder on first use so that the module can be loaded without the encoding.
	if (!shiftJisDecoder) {
		shiftJisDecoder = new TextDecoder('shift_jis');
	}
	return shiftJisDecoder.decode(bytes);
}

export function decodeUtf8(bytes) {
	console.assert(bytes instanceof Uint8Array);

	if (!utf8Decoder) {
		utf8Decoder = new TextDecoder('utf-8');
	}
	return utf8Decoder.decode(bytes);
}

// Splits a decoded path into a directory part (with a trailing '/') and a file name.
export function splitPath(path) {
	console.assert(typeof path === 'string');

	const index = path.lastIndexOf('/');
	return {directory: path.slice(0, index + 1), name: path.slice(index + 1)};
}

// CRC-16 (ANSI, used by LZH) and CRC-32 (used by zip).
function makeCrcTable(polynomial, bitWidth) {
	console.assert(bitWidth === 16 || bitWidth === 32, `Unsupported CRC width: ${bitWidth}`);

	const table = (bitWidth === 32) ? new Uint32Array(256) : new Uint16Array(256);

	for (let i = 0; i < 256; i++) {
		let value = i;

		for (let bitNo = 0; bitNo < 8; bitNo++) {
			value = ((value & 1) !== 0) ? ((value >>> 1) ^ polynomial) : (value >>> 1);
		}

		table[i] = value;
	}

	return table;
}

export function computeCrc16(bytes, crc = 0) {
	console.assert(bytes instanceof Uint8Array && Number.isInteger(crc));

	let value = crc & 0xffff;
	for (const byte of bytes) {
		value = crc16Table[(value ^ byte) & 0xff] ^ (value >>> 8);
	}
	return value;
}

export function computeCrc32(bytes, crc = 0) {
	console.assert(bytes instanceof Uint8Array && Number.isInteger(crc));

	let value = ~crc;
	for (const byte of bytes) {
		value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
	}
	return (~value) >>> 0;
}
