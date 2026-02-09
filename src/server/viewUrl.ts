import { config } from "../config.js";

const buildBaseUrl = () => {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `http://${config.host}:${config.port}`;
};

export const buildViewUrl = (sessionId: string) => {
  const base = buildBaseUrl().replace(/\/+$/, "");
  return `${base}/session/view/${sessionId}`;
};
