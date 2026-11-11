import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/"
});

const win = dom.window as unknown as Record<string, unknown>;
const g = globalThis as Record<string, unknown>;

const assignProp = (key: string, value: unknown) => {
  Object.defineProperty(g, key, {
    value,
    configurable: true,
    writable: true
  });
};

assignProp("React", React);

assignProp("window", dom.window);
assignProp("document", dom.window.document);
assignProp("navigator", dom.window.navigator);
assignProp("localStorage", dom.window.localStorage);
assignProp("HTMLElement", dom.window.HTMLElement);
assignProp("HTMLInputElement", dom.window.HTMLInputElement);
assignProp("HTMLTextAreaElement", dom.window.HTMLTextAreaElement);
assignProp("HTMLSelectElement", dom.window.HTMLSelectElement);
assignProp("HTMLButtonElement", dom.window.HTMLButtonElement);
assignProp("HTMLFormElement", dom.window.HTMLFormElement);
assignProp("HTMLDialogElement", dom.window.HTMLDialogElement);
assignProp("Element", dom.window.Element);
assignProp("Node", dom.window.Node);
assignProp("Event", dom.window.Event);
assignProp("CustomEvent", dom.window.CustomEvent);
assignProp("MouseEvent", dom.window.MouseEvent);
assignProp("KeyboardEvent", dom.window.KeyboardEvent);
assignProp("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));

if (typeof g.requestAnimationFrame !== "function") {
  assignProp("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
  assignProp("cancelAnimationFrame", (id: number) => clearTimeout(id));
}

const dialogProto = dom.window.HTMLDialogElement.prototype as HTMLDialogElement & {
  showModal?: () => void;
  close?: (returnValue?: string) => void;
};

if (typeof dialogProto.showModal !== "function") {
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
}

if (typeof dialogProto.close !== "function") {
  dialogProto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }
    this.removeAttribute("open");
    this.dispatchEvent(new dom.window.Event("close"));
  };
}

// Suprime aviso do React em testes com `act(...)` quando necessário.
void win;
