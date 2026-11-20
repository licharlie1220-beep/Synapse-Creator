export interface CaretCoords {
  top: number;
  left: number;
}

const MIRROR_PROPERTIES = [
  'direction',
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const;

export function getTextareaSelectionTopCoords(
  textarea: HTMLTextAreaElement,
  selectionStart: number
): CaretCoords {
  const div = document.createElement('div');
  const style = div.style;
  const computed = window.getComputedStyle(textarea);

  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.pointerEvents = 'none';
  style.top = '0px';
  style.left = '-9999px';

  for (const prop of MIRROR_PROPERTIES) {
    style[prop] = computed[prop];
  }

  // Ensure mirror uses scroll-accurate width
  style.overflow = 'hidden';

  div.textContent = textarea.value.substring(0, selectionStart);
  const span = document.createElement('span');
  span.textContent = textarea.value.substring(selectionStart, selectionStart + 1) || '.';
  div.appendChild(span);

  document.body.appendChild(div);
  const top = span.offsetTop - textarea.scrollTop;
  const left = span.offsetLeft - textarea.scrollLeft;
  document.body.removeChild(div);

  return { top, left };
}
