declare module "citeproc" {
  const CSL: {
    Engine: unknown;
    Output: { Formats: object; Formatters: { passthrough: (state: unknown, str: string) => string } };
  };
  export default CSL;
}
