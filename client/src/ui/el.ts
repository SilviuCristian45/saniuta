// document.createElement helper for the HTML parts of the UI.

export type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  /** Any other attribute (type, aria-label, inputmode...). */
  attrs?: Record<string, string>;
  onClick?: (e: MouseEvent) => void;
}

/** document.createElement with a class, text, attributes and children in one go. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElProps = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  const onClick = props.onClick;
  if (onClick) node.addEventListener('click', (e) => onClick(e as MouseEvent));
  for (const child of children) if (child) node.append(child);
  return node;
}

/** True while the player types into a text field (keys then belong to the field, not the game). */
export function isTyping(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
}
