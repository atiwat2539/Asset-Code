/// <reference types="vite/client" />

declare module 'jsbarcode' {
  function JsBarcode(
    element: SVGElement | HTMLElement | string,
    data: string,
    options?: Record<string, unknown>
  ): void;
  export default JsBarcode;
}
