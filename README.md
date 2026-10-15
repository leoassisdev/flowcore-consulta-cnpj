# Consulta de CNPJ

> Busca razão social, situação, CNAE, endereço e sócios na BrasilAPI com fallback ReceitaWS, timeout e cache. Onboarding B2B sem digitação manual.

**Ver ao vivo, com preview e manual:** https://flowcoresolucoes.com.br/codigos/consulta-cnpj

Criado por **FlowCore Soluções LTDA**.

## Arquivos

- [`src/consulta-cnpj.ts`](src/consulta-cnpj.ts)
- [`src/consulta-cnpj.test.ts`](src/consulta-cnpj.test.ts)

## Como instalar

1. **Funciona onde você já roda** Node 18+, Cloudflare Workers, Deno, Bun, Vercel e Netlify Functions. Zero dependência: só fetch e Web Crypto, que já vêm no runtime.
2. **Crie src/lib/consulta-cnpj.ts** Copie o conteúdo de `src/consulta-cnpj.ts` e `src/consulta-cnpj.test.ts` deste repositório.
3. **Use**

   ```bash
   const cnpj = criarConsultaCnpj({ timeoutMs: 8000 });
   const empresa = await cnpj.consultar("11.222.333/0001-81");
   if (empresa?.situacao !== "ATIVA") throw new Error("CNPJ inativo");
   console.log(empresa.razaoSocial, empresa.endereco.municipio);
   ```

4. **Rode o teste junto** O arquivo de teste (`src/consulta-cnpj.test.ts`) cobre 9 cenários. Copie para src/lib/ ao lado e rode:

   ```bash
   npm install -D vitest
   npx vitest run src/lib
   ```


## Testes

`src/consulta-cnpj.test.ts` cobre 9 cenários.

```bash
npm install
npm test
```

## Licença

MIT. Pode usar em projeto pessoal ou comercial, de graça. A única condição é manter a linha **“Criado por FlowCore Soluções LTDA”** (ou o crédito de adaptação) onde ela está.

---

Precisa disso integrado no seu sistema? A [FlowCore](https://flowcoresolucoes.com.br) desenvolve sob medida.
