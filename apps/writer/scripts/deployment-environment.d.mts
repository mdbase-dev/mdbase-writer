export interface WriterDeployment {
  readonly origin: string;
  readonly connectUrl: string;
  readonly loopbackUrl: string;
  readonly branch: string;
  readonly demo: boolean;
}

export declare const writerDeployments: Readonly<Record<"lab" | "staging" | "production", WriterDeployment>>;
