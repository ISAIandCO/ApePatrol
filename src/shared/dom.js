export function setSafeText(element, value) {
  element.textContent = value === null || value === undefined ? "" : String(value);
  return element;
}
