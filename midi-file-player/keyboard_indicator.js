const HEIGHT_RATE = 0.5;
const SHARP_HEIGHT_RATE = 95 / 150;

const BOTTOM_KEY_WIDTH = 8;
const OCTAVE_WIDTH = BOTTOM_KEY_WIDTH * 7;
const LEFTSIDE_TOP_KEY_WIDTH  = BOTTOM_KEY_WIDTH * 3 / 5;
const RIGHTSIDE_TOP_KEY_WIDTH = BOTTOM_KEY_WIDTH * 4 / 7;
const KEY_HEIGHT = OCTAVE_WIDTH * 150 / 165 * HEIGHT_RATE;

const offsetsX = [...Array(12)].map((_, i) => {
	if (i < 5) {
		if (isBlackKey(i)) {
			return LEFTSIDE_TOP_KEY_WIDTH * i;
		} else {
			return BOTTOM_KEY_WIDTH * Math.trunc(i / 2);
		}
	} else {
		if (isBlackKey(i)) {
			return LEFTSIDE_TOP_KEY_WIDTH * 5 + RIGHTSIDE_TOP_KEY_WIDTH * (i - 5);
		} else {
			return LEFTSIDE_TOP_KEY_WIDTH * 5 + BOTTOM_KEY_WIDTH * Math.trunc((i - 5) / 2);
		}
	}
});

const elemSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
elemSvg.setAttribute('viewBox', `0 0 ${BOTTOM_KEY_WIDTH * 75} ${KEY_HEIGHT}`);
elemSvg.innerHTML = `
<style type="text/css">
:host {
	display: block;
	width: 100%;
	line-height: 0;

	--active-color-hue: 215;	/* Default color hue */
}

rect {
	stroke: currentColor;
	stroke-opacity: 0.25;
}
rect.active {
	animation: note-on 0.5s ease-out both;
}

@keyframes note-on {
	0% {
		fill: hsl(var(--active-color-hue), 100%, 67%);
		stroke-color: hsl(var(--active-color-hue), 67%, 50%);
	}
	100% {
		fill: hsl(var(--active-color-hue), 67%, 50%);
		stroke-color: currentColor;
	}
}
</style>
<defs>
	<linearGradient id="gradient-white-base" gradientTransform="rotate(90)">
		<stop stop-color="currentColor" stop-opacity="0.25" offset="0%" />
		<stop stop-color="currentColor" stop-opacity="0" offset="100%" />
	</linearGradient>
	<linearGradient id="gradient-black-base" gradientTransform="rotate(90)">
		<stop stop-color="currentColor" stop-opacity="0.875" offset="0%" />
		<stop stop-color="currentColor" stop-opacity="1" offset="100%" />
	</linearGradient>
</defs>
${makeKeyStr()}`;

function isBlackKey(noteNo) {
	return [1, 3, 6, 8, 10].includes(noteNo % 12);
}

function makeKeyStr() {
	let str = '';

	for (let noteNo = 0; noteNo < 128; noteNo++) {
		if (!isBlackKey(noteNo)) {
			str += `<rect id="note${noteNo}" class="white" x="${OCTAVE_WIDTH * Math.trunc(noteNo / 12) + offsetsX[noteNo % 12]}" y="0" width="${BOTTOM_KEY_WIDTH}" height="${KEY_HEIGHT}" fill="url(#gradient-white-base)" />`;
		}
	}
	for (let noteNo = 0; noteNo < 128; noteNo++) {
		if (isBlackKey(noteNo)) {
			str += `<rect id="note${noteNo}" class="black" x="${OCTAVE_WIDTH * Math.trunc(noteNo / 12) + offsetsX[noteNo % 12]}" y="0" width="${(noteNo % 12 < 5) ? LEFTSIDE_TOP_KEY_WIDTH : RIGHTSIDE_TOP_KEY_WIDTH}" height="${KEY_HEIGHT * SHARP_HEIGHT_RATE}" fill="url(#gradient-black-base)" />`;
		}
	}

	return str;
}

export class KeyboardIndicator extends HTMLElement {
	constructor() {
		super();

		this._elemSvg = elemSvg.cloneNode(true);
		this._elemKeys = [...this._elemSvg.querySelectorAll('rect[id^=note]')].sort((a, b) => Number(a.id.match(/\d+/u)) - Number(b.id.match(/\d+/u)));
		console.assert(this._elemKeys.length === 128);

		// Creates and attaches the shadow root.
		this._shadowRoot = this.attachShadow({mode: 'open'});
		this._shadowRoot.append(this._elemSvg);
	}

	reset() {
		this.noteOff([...new Array(128)].map((_, i) => i));
	}

	noteOn(noteNo) {
		const noteNos = (Number.isInteger(noteNo)) ? [noteNo] : noteNo;
		console.assert(noteNos.every((e) => (0 <= e && e < 128)));
		for (const noteNo of noteNos) {
			this._elemKeys[noteNo].classList.add('active');
		}
	}

	noteOff(noteNo) {
		const noteNos = (Number.isInteger(noteNo)) ? [noteNo] : noteNo;
		console.assert(noteNos.every((e) => (0 <= e && e < 128)));
		for (const noteNo of noteNos) {
			this._elemKeys[noteNo].classList.remove('active');
		}
	}
}

window.customElements.define('keyboard-indicator', KeyboardIndicator);
