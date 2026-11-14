export interface WriterDeployment {
  readonly origin: string;
  readonly editorUrl: string;
  readonly readerUrl: string;
  readonly connectUrl: string;
  readonly branch: string;
  readonly demo: boolean;
}

export declare const writerDeployments: Readonly<Record<"lab" | "staging" | "production", WriterDeployment>>;
export declare function writerAppUrlsFor(target: "lab" | "staging" | "production", environment?: Record<string, string | undefined>): Record<"editor" | "reader" | "writer", string>;
