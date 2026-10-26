/** User or authority text placed inside a rich-text <Trans> message. A React
 * child is never reparsed, so markup-shaped text such as `<0/>` stays literal. */
export const literal = (text: string) => <>{text}</>;
