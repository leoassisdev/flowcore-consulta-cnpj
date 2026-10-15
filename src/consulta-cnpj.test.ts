// consulta-cnpj.test.ts · Criado por FlowCore Soluções LTDA · flowcoresolucoes.com.br/codigos · licença MIT
import { describe, expect, it, vi } from "vitest";
import { cnpjValido, criarConsultaCnpj, ErroConsultaCnpj, type FetchLike } from "./consulta-cnpj";

const CNPJ = "11222333000181";

const resposta = (corpo: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

const brasilApi = {
  cnpj: CNPJ,
  razao_social: "EMPRESA TESTE LTDA",
  nome_fantasia: "",
  descricao_situacao_cadastral: "ATIVA",
  data_inicio_atividade: "2010-05-20",
  natureza_juridica: "Sociedade Empresária Limitada",
  porte: "DEMAIS",
  capital_social: 150000,
  cnae_fiscal: 6201501,
  cnae_fiscal_descricao: "Desenvolvimento de programas de computador sob encomenda",
  cnaes_secundarios: [{ codigo: 0, descricao: "" }, { codigo: 6204000, descricao: "Consultoria em TI" }],
  descricao_tipo_de_logradouro: "RUA",
  logradouro: "DAS FLORES",
  numero: "100",
  complemento: null,
  bairro: "CENTRO",
  municipio: "SAO PAULO",
  uf: "SP",
  cep: "01001000",
  ddd_telefone_1: "1133334444",
  email: "CONTATO@EMPRESA.COM.BR",
  qsa: [{ nome_socio: "FULANO DE TAL", qualificacao_socio: "Sócio-Administrador" }],
  opcao_pelo_simples: false,
  opcao_pelo_mei: false,
};

const receitaWs = {
  status: "OK",
  cnpj: "11.222.333/0001-81",
  nome: "EMPRESA TESTE LTDA",
  fantasia: "TESTE",
  situacao: "ATIVA",
  abertura: "20/05/2010",
  capital_social: "150000.00",
  atividade_principal: [{ code: "62.01-5-01", text: "Desenvolvimento de programas" }],
  atividades_secundarias: [{ code: "00.00-0-00", text: "Não informada" }],
  logradouro: "RUA DAS FLORES",
  numero: "100",
  municipio: "SAO PAULO",
  uf: "SP",
  cep: "01.001-000",
  telefone: "(11) 3333-4444 / (11) 5555-6666",
  qsa: [{ nome: "FULANO DE TAL", qual: "49-Sócio-Administrador" }],
  simples: { optante: true },
  simei: { optante: false },
};

describe("consulta-cnpj", () => {
  it("valida o CNPJ antes de chamar a rede", async () => {
    const f = vi.fn<FetchLike>();
    const api = criarConsultaCnpj({ fetch: f });
    await expect(api.consultar("11.222.333/0001-82")).rejects.toMatchObject({ codigo: "CNPJ_INVALIDO" });
    expect(f).not.toHaveBeenCalled();
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
  });

  it("normaliza a resposta da BrasilAPI e envia User-Agent", async () => {
    const f = vi.fn<FetchLike>(async () => resposta(brasilApi));
    const empresa = await criarConsultaCnpj({ fetch: f }).consultar("11.222.333/0001-81");
    expect(f.mock.calls[0][0]).toBe(`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`);
    const headers = f.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("FlowCore");
    expect(empresa).toMatchObject({
      cnpj: CNPJ,
      razaoSocial: "EMPRESA TESTE LTDA",
      nomeFantasia: null,
      abertura: "2010-05-20",
      capitalSocial: 150000,
      cnaePrincipal: { codigo: "62.01-5-01" },
      cnaesSecundarios: [{ codigo: "62.04-0-00", descricao: "Consultoria em TI" }],
      endereco: { logradouro: "RUA DAS FLORES", cep: "01001000", uf: "SP" },
      email: "contato@empresa.com.br",
      socios: [{ nome: "FULANO DE TAL", qualificacao: "Sócio-Administrador" }],
      fonte: "brasilapi",
    });
  });

  it("cai pro fallback ReceitaWS quando a BrasilAPI falha com 5xx", async () => {
    const f = vi.fn<FetchLike>(async (url) => (url.includes("brasilapi") ? resposta({}, 503) : resposta(receitaWs)));
    const empresa = await criarConsultaCnpj({ fetch: f }).consultar(CNPJ);
    expect(f).toHaveBeenCalledTimes(2);
    expect(empresa).toMatchObject({
      fonte: "receitaws",
      abertura: "2010-05-20",
      capitalSocial: 150000,
      cnaesSecundarios: [],
      telefone: "1133334444",
      endereco: { cep: "01001000" },
      optanteSimples: true,
      optanteMei: false,
    });
  });

  it("retorna null quando o CNPJ não existe (404), sem fallback", async () => {
    const f = vi.fn<FetchLike>(async () => resposta({ message: "CNPJ não encontrado" }, 404));
    expect(await criarConsultaCnpj({ fetch: f }).consultar(CNPJ)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("usa o cache dentro do TTL e consulta de novo depois", async () => {
    let agora = 1_000;
    const f = vi.fn<FetchLike>(async () => resposta(brasilApi));
    const api = criarConsultaCnpj({ fetch: f, now: () => agora, cacheTtlMs: 60_000 });
    await api.consultar(CNPJ);
    await api.consultar(CNPJ);
    expect(f).toHaveBeenCalledTimes(1);
    agora += 60_001;
    await api.consultar(CNPJ);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("deduplica consultas simultâneas do mesmo CNPJ", async () => {
    const f = vi.fn<FetchLike>(async () => resposta(brasilApi));
    const api = criarConsultaCnpj({ fetch: f });
    await Promise.all([api.consultar(CNPJ), api.consultar(CNPJ), api.consultar(CNPJ)]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("aborta por timeout e informa quando todas as fontes falham", async () => {
    const travado: FetchLike = (_url, init) =>
      new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))));
    const api = criarConsultaCnpj({ fetch: travado, timeoutMs: 10 });
    const erro = await api.consultar(CNPJ).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroConsultaCnpj);
    expect(erro.codigo).toBe("TIMEOUT");
    expect(erro.message).toContain("Nenhuma fonte respondeu");
  });

  it("permite desligar fallback e User-Agent", async () => {
    const f = vi.fn<FetchLike>(async () => resposta({}, 500));
    const api = criarConsultaCnpj({ fetch: f, urlFallback: null, userAgent: false });
    await expect(api.consultar(CNPJ)).rejects.toMatchObject({ codigo: "INDISPONIVEL" });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)["User-Agent"]).toBeUndefined();
  });

  it("trata status ERROR da ReceitaWS como não encontrado", async () => {
    const f = vi.fn<FetchLike>(async (url) =>
      url.includes("brasilapi") ? Promise.reject(new Error("ECONNRESET")) : resposta({ status: "ERROR", message: "CNPJ inválido" }),
    );
    expect(await criarConsultaCnpj({ fetch: f }).consultar(CNPJ)).toBeNull();
  });
});
