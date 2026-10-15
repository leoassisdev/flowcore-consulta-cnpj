// consulta-cnpj.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
// Consulta dados públicos de um CNPJ (razão social, situação, CNAE, endereço,
// sócios) na BrasilAPI com fallback automático pra uma API compatível com a
// ReceitaWS. Timeout por AbortController, cache em memória com TTL e retorno
// normalizado, igual seja qual for a fonte.
// Roda em Node 18+, Cloudflare Workers, Deno e Bun (server-side).
// Zero dependências.
//
// Referências: BrasilAPI (brasilapi.com.br/docs#tag/CNPJ) e ReceitaWS
// (developers.receitaws.com.br), ambas com dados abertos da Receita Federal.

export const CRIADO_POR = "Criado por FlowCore Soluções LTDA";
export const USER_AGENT_PADRAO = "FlowCore-Codigos/1.0 (Criado por FlowCore Soluções LTDA)";

export type RespostaHttp = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};
export type FetchLike = (url: string, init?: RequestInit) => Promise<RespostaHttp>;

export type Empresa = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string | null;
  /** Data de abertura em ISO (AAAA-MM-DD). */
  abertura: string | null;
  naturezaJuridica: string | null;
  porte: string | null;
  capitalSocial: number | null;
  cnaePrincipal: { codigo: string; descricao: string } | null;
  cnaesSecundarios: { codigo: string; descricao: string }[];
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    municipio: string | null;
    uf: string | null;
    cep: string | null;
  };
  telefone: string | null;
  email: string | null;
  socios: { nome: string; qualificacao: string | null }[];
  optanteSimples: boolean | null;
  optanteMei: boolean | null;
  fonte: "brasilapi" | "receitaws";
};

export type OpcoesConsultaCnpj = {
  fetch?: FetchLike;
  /** Tempo máximo por requisição, em ms. Padrão 8000. */
  timeoutMs?: number;
  /** Validade do cache em ms. Padrão 24h. 0 desliga o cache. */
  cacheTtlMs?: number;
  now?: () => number;
  /** URL da fonte principal. Padrão BrasilAPI. */
  urlPrincipal?: (cnpj: string) => string;
  /** URL da fonte de fallback (formato ReceitaWS). null desliga o fallback. */
  urlFallback?: ((cnpj: string) => string) | null;
  /** User-Agent enviado (server-side). false não envia. */
  userAgent?: string | false;
  /** Headers extras pro fallback (ex.: Authorization do plano pago da ReceitaWS). */
  headersFallback?: Record<string, string>;
};

export class ErroConsultaCnpj extends Error {
  constructor(
    message: string,
    readonly codigo: "CNPJ_INVALIDO" | "INDISPONIVEL" | "TIMEOUT",
  ) {
    super(message);
    this.name = "ErroConsultaCnpj";
  }
}

/** Confere os DVs do CNPJ (numérico ou alfanumérico). */
export function cnpjValido(valor: string): boolean {
  const c = valor.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (base.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.slice(12) === `${d1}${d2}`;
}

type Bruto = Record<string, unknown>;
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const soDigitos = (v: unknown) => texto(v)?.replace(/\D/g, "") || null;
const lista = (v: unknown): Bruto[] => (Array.isArray(v) ? (v as Bruto[]) : []);

function dataIso(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatarCnae(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 7 ? `${d.slice(0, 2)}.${d.slice(2, 4)}-${d.slice(4, 5)}-${d.slice(5)}` : String(v ?? "");
}

/** Converte o JSON da BrasilAPI pro formato normalizado. */
export function normalizarBrasilApi(d: Bruto): Empresa {
  const logradouro = [texto(d.descricao_tipo_de_logradouro), texto(d.logradouro)].filter(Boolean).join(" ") || null;
  return {
    cnpj: String(d.cnpj ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase(),
    razaoSocial: texto(d.razao_social) ?? "",
    nomeFantasia: texto(d.nome_fantasia),
    situacao: texto(d.descricao_situacao_cadastral),
    abertura: dataIso(d.data_inicio_atividade),
    naturezaJuridica: texto(d.natureza_juridica),
    porte: texto(d.porte),
    capitalSocial: numero(d.capital_social),
    cnaePrincipal: d.cnae_fiscal ? { codigo: formatarCnae(d.cnae_fiscal), descricao: texto(d.cnae_fiscal_descricao) ?? "" } : null,
    cnaesSecundarios: lista(d.cnaes_secundarios)
      .filter((c) => Number(c.codigo) > 0)
      .map((c) => ({ codigo: formatarCnae(c.codigo), descricao: texto(c.descricao) ?? "" })),
    endereco: {
      logradouro,
      numero: texto(d.numero),
      complemento: texto(d.complemento),
      bairro: texto(d.bairro),
      municipio: texto(d.municipio),
      uf: texto(d.uf),
      cep: soDigitos(d.cep),
    },
    telefone: soDigitos(d.ddd_telefone_1),
    email: texto(d.email)?.toLowerCase() ?? null,
    socios: lista(d.qsa).map((s) => ({ nome: texto(s.nome_socio) ?? "", qualificacao: texto(s.qualificacao_socio) })),
    optanteSimples: typeof d.opcao_pelo_simples === "boolean" ? d.opcao_pelo_simples : null,
    optanteMei: typeof d.opcao_pelo_mei === "boolean" ? d.opcao_pelo_mei : null,
    fonte: "brasilapi",
  };
}

/** Converte o JSON no formato ReceitaWS pro formato normalizado. */
export function normalizarReceitaWs(d: Bruto): Empresa {
  const atividade = (a: Bruto) => ({ codigo: texto(a.code) ?? "", descricao: texto(a.text) ?? "" });
  const principal = lista(d.atividade_principal)[0];
  const optante = (v: unknown) => (v && typeof v === "object" && "optante" in v ? Boolean((v as Bruto).optante) : null);
  return {
    cnpj: String(d.cnpj ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase(),
    razaoSocial: texto(d.nome) ?? "",
    nomeFantasia: texto(d.fantasia),
    situacao: texto(d.situacao),
    abertura: dataIso(d.abertura),
    naturezaJuridica: texto(d.natureza_juridica),
    porte: texto(d.porte),
    capitalSocial: numero(d.capital_social),
    cnaePrincipal: principal ? atividade(principal) : null,
    cnaesSecundarios: lista(d.atividades_secundarias)
      .map(atividade)
      .filter((a) => a.codigo && a.codigo !== "00.00-0-00"),
    endereco: {
      logradouro: texto(d.logradouro),
      numero: texto(d.numero),
      complemento: texto(d.complemento),
      bairro: texto(d.bairro),
      municipio: texto(d.municipio),
      uf: texto(d.uf),
      cep: soDigitos(d.cep),
    },
    telefone: soDigitos(String(d.telefone ?? "").split("/")[0]),
    email: texto(d.email)?.toLowerCase() ?? null,
    socios: lista(d.qsa).map((s) => ({ nome: texto(s.nome) ?? "", qualificacao: texto(s.qual) })),
    optanteSimples: optante(d.simples),
    optanteMei: optante(d.simei),
    fonte: "receitaws",
  };
}

class NaoEncontrado extends Error {}

export function criarConsultaCnpj(opcoes: OpcoesConsultaCnpj = {}) {
  const f: FetchLike = opcoes.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opcoes.timeoutMs ?? 8000;
  const ttl = opcoes.cacheTtlMs ?? 24 * 60 * 60 * 1000;
  const now = opcoes.now ?? Date.now;
  const urlPrincipal = opcoes.urlPrincipal ?? ((c: string) => `https://brasilapi.com.br/api/cnpj/v1/${c}`);
  const urlFallback =
    opcoes.urlFallback === undefined ? (c: string) => `https://receitaws.com.br/v1/cnpj/${c}` : opcoes.urlFallback;
  const ua = opcoes.userAgent === undefined ? USER_AGENT_PADRAO : opcoes.userAgent;

  const cache = new Map<string, { valor: Empresa | null; expira: number }>();
  const emAndamento = new Map<string, Promise<Empresa | null>>();

  async function buscarJson(url: string, extras?: Record<string, string>): Promise<Bruto> {
    const headers: Record<string, string> = { Accept: "application/json", ...extras };
    if (ua) headers["User-Agent"] = ua;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp: RespostaHttp;
    try {
      resp = await f(url, { headers, signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted) throw new ErroConsultaCnpj(`Tempo esgotado (${timeoutMs} ms) consultando ${url}`, "TIMEOUT");
      throw new ErroConsultaCnpj(`Falha de rede consultando ${url}: ${(e as Error).message}`, "INDISPONIVEL");
    } finally {
      clearTimeout(timer);
    }
    if (resp.status === 404) throw new NaoEncontrado();
    if (!resp.ok) throw new ErroConsultaCnpj(`HTTP ${resp.status} em ${url}`, "INDISPONIVEL");
    const corpo = (await resp.json()) as Bruto;
    if (!corpo || typeof corpo !== "object") throw new ErroConsultaCnpj(`Resposta inválida de ${url}`, "INDISPONIVEL");
    return corpo;
  }

  async function buscar(cnpj: string): Promise<Empresa | null> {
    try {
      return normalizarBrasilApi(await buscarJson(urlPrincipal(cnpj)));
    } catch (erroPrincipal) {
      if (erroPrincipal instanceof NaoEncontrado) return null;
      if (!urlFallback) throw erroPrincipal;
      try {
        const d = await buscarJson(urlFallback(cnpj), opcoes.headersFallback);
        if (d.status === "ERROR") {
          if (/inv[aá]lido|n[aã]o encontrado|rejeitado/i.test(String(d.message ?? ""))) return null;
          throw new ErroConsultaCnpj(`ReceitaWS: ${String(d.message ?? "erro")}`, "INDISPONIVEL");
        }
        return normalizarReceitaWs(d);
      } catch (erroFallback) {
        if (erroFallback instanceof NaoEncontrado) return null;
        const msg = (e: unknown) => (e as Error).message;
        throw new ErroConsultaCnpj(
          `Nenhuma fonte respondeu. Principal: ${msg(erroPrincipal)}. Fallback: ${msg(erroFallback)}`,
          erroPrincipal instanceof ErroConsultaCnpj && erroPrincipal.codigo === "TIMEOUT" ? "TIMEOUT" : "INDISPONIVEL",
        );
      }
    }
  }

  return {
    /** Retorna a empresa normalizada ou null se o CNPJ não existe na base. */
    async consultar(cnpjEntrada: string): Promise<Empresa | null> {
      const cnpj = cnpjEntrada.toUpperCase().replace(/[^0-9A-Z]/g, "");
      if (!cnpjValido(cnpj)) throw new ErroConsultaCnpj("CNPJ inválido (dígito verificador não confere)", "CNPJ_INVALIDO");

      const hit = cache.get(cnpj);
      if (hit && hit.expira > now()) return hit.valor;

      const pendente = emAndamento.get(cnpj);
      if (pendente) return pendente;

      const p = buscar(cnpj)
        .then((valor) => {
          if (ttl > 0) cache.set(cnpj, { valor, expira: now() + ttl });
          return valor;
        })
        .finally(() => emAndamento.delete(cnpj));
      emAndamento.set(cnpj, p);
      return p;
    },
    limparCache() {
      cache.clear();
    },
  };
}
