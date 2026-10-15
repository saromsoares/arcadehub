export type EmailSignature = {
  url: string | null;
  alt: string;
  plainText: string;
};

const SIGNATURE_BASE = "https://arcadehub.tech/assets/email-signatures/";
const SIGNATURES: Record<string, Omit<EmailSignature, "url"> | null> = {
  arcade_hub: {
    alt: "Suporte Arcade Hub. Obrigado pelo seu contato!",
    plainText: "Obrigado pelo seu contato!\nSuporte Arcade Hub | suporte@arcadehub.tech",
  },
  cbai_solutions: {
    alt: "Suporte Arcade Hub. Obrigado pelo seu contato!",
    plainText: "Obrigado pelo seu contato!\nSuporte Arcade Hub | suporte@cbaisolutions.com.br",
  },
  jogadaca: {
    alt: "Contato Jogadaça.ai. Obrigado pelo seu contato! Thank you for contacting us! Gracias por contactarnos!",
    plainText: "Obrigado pelo seu contato!\nJogadaça.ai | contato@jogadaca.ai",
  },
  conferecheck: {
    alt: "Contato ConfereCheck. Obrigado pelo seu contato! Thank you for contacting us! Gracias por contactarnos!",
    plainText: "Obrigado pelo seu contato!\nConfereCheck | contato@conferecheck.com.br",
  },
  privabr: {
    alt: "Suporte PrivaBR. Obrigado pelo seu contato!",
    plainText: "Obrigado pelo seu contato!\nSuporte PrivaBR | suporte@privabr.com.br",
  },
  liquida_pecas: {
    alt: "Contato Líquida Peças. Obrigado pelo seu contato! Thank you for contacting us! Gracias por contactarnos!",
    plainText: "Obrigado pelo seu contato!\nLíquida Peças | contato@liquidapecas.com.br",
  },
  coben: {
    alt: "Coben | contato@coben.app",
    plainText: "Coben | contato@coben.app",
  },
};
const ASSET_FILE: Record<string, string> = {
  arcade_hub: "arcade.png",
  cbai_solutions: "arcade.png",
  jogadaca: "jogadaca.png",
  conferecheck: "conferecheck.png",
  privabr: "privabr.png",
  liquida_pecas: "liquida-pecas.png",
};

export function emailSignature(mailboxId: string): EmailSignature | null {
  const details = SIGNATURES[mailboxId];
  const asset = ASSET_FILE[mailboxId];
  return details ? { ...details, url: asset ? SIGNATURE_BASE + asset : null } : null;
}
