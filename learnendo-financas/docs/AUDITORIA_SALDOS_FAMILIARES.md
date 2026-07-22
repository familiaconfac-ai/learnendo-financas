# Auditoria de saldos familiares

## Estrutura encontrada

- Autenticacao e perfil: `users/{uid}` e Firebase Authentication.
- Vinculo moderno: `users/{uid}/workspaceMemberships/{workspaceId}`.
- Familia moderna: `workspaces/{workspaceId}` e `workspaces/{workspaceId}/members/{uid}`.
- Espelho legado: `families/{familyId}` e `families/{familyId}/members/{uidOuMemberId}`.
- Saldos entre membros: `workspaces/{workspaceId}/debts/{debtId}`.
- Restituicoes: array `settlements` dentro da divida; uma confirmacao tambem pode criar um documento em `workspaces/{workspaceId}/transactions`.
- Movimentacoes legadas: `families/{familyId}/transactions`.
- Log imutavel novo: `workspaces/{workspaceId}/financialAuditLogs`.
- Ajustes controlados: `workspaces/{workspaceId}/auditAdjustments/{auditId}`.

O saldo exibido e derivado de credor, devedor, valor original, compensacao inicial, restituicoes confirmadas e lancamentos vinculados. Documentos com `status: "deleted"` ou `deletedAt` ficam fora do saldo normal, mas continuam na auditoria.

## Causa do seletor vazio

A tela usava a lista moderna inteira sempre que ela possuia pelo menos um item. Quando apenas o usuario atual havia sido sincronizado em `workspaces/{workspaceId}/members`, os demais membros que ainda estavam somente no espelho `families/{familyId}/members` eram descartados. O filtro seguinte removia o proprio usuario e deixava o seletor vazio.

A leitura agora combina e deduplica as duas fontes por `uid`, `memberId`, `userId`, `familyMemberId` ou `id`, aceita estruturas legadas, considera somente membros ativos, remove o usuario atual e grava o ID real. O formulario mostra carregamento, erro e familia sem outros membros.

## Executar a auditoria cruzada

1. Publique primeiro as regras atualizadas do Firestore no ambiente de homologacao.
2. Entre com uma conta cujo perfil `users/{uid}.role` seja `admin`.
3. Abra `/admin` e localize **Auditoria de saldos familiares**.
4. Selecione Eric, Levi e Arthur conferindo nome, e-mail e UID. Se algum deles nao possuir documento em `users`, informe UID ou e-mail exato no campo manual.
5. Clique em **Executar auditoria cruzada somente leitura**.
6. Revise as visoes individuais, o impedimento cadastral do Arthur e a tabela cronologica consolidada.
7. Exporte JSON e CSV separados para Eric, Levi, Arthur e para o consolidado.

A execucao acima usa obrigatoriamente `dryRun: true` e `auditOnly: true`. Ela nao cria relatorio no Firestore, nao altera saldos e nao restaura documentos.

### Verificacao do Firebase Authentication

A existencia no Authentication e consultada pela funcao server-side `api/adminIdentityAudit.js`. A rota valida o ID token do solicitante e confirma o papel `admin` antes de chamar o Firebase Admin SDK. Ela e estritamente somente leitura.

Configure no ambiente de hospedagem uma das opcoes suportadas:

- `FIREBASE_SERVICE_ACCOUNT_JSON`; ou
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`; ou
- credenciais padrao do ambiente Google.

Sem credenciais server-side, o restante da auditoria Firestore continua disponivel, mas o painel marca Authentication como **nao confirmado** em vez de presumir que o usuario existe.

A mesma rota usa `listCollections()` em modo somente leitura para descobrir colecoes financeiras antigas cujos nomes nao aparecem mais no frontend. A varredura:

- restringe-se a nomes relacionados a divida, saldo, transacao, pagamento, restituicao, compensacao, ajuste, historico ou auditoria;
- devolve somente documentos que contenham UID, e-mail ou nome de um dos tres membros;
- le no maximo 500 documentos por colecao e 1.000 achados no total;
- marca truncamento e erros de leitura no relatorio;
- classifica os achados como divida, transacao ou evidencia de auditoria sem migrar qualquer documento.

### Visao consolidada

A tabela **Auditoria cruzada — Eric, Levi e Arthur** deduplica o mesmo documento encontrado em mais de um relatorio e permite filtrar por membro, relacoes entre os tres, abertas, quitadas, canceladas, excluidas, duplicadas, orfas e inconsistentes. Cada linha informa se participou diretamente do calculo ou se e apenas evidencia informativa ja incorporada na divida principal.

Para Levi, o painel demonstra o resultado pela formula:

```text
creditos reconstruidos em aberto - debitos reconstruidos em aberto = saldo reconstruido
```

Arthur recebe ainda diagnostico de `users`, Authentication, `workspaces`, `families`, convites, status, UID divergente, IDs antigos e referencias financeiras mesmo quando o vinculo cadastral falhou.

## Restauracao controlada fora da auditoria cruzada

O fluxo cruzado de Eric, Levi e Arthur nao exibe nem executa restauracao. A infraestrutura anterior de ajuste permanece separada no servico e somente pode ser usada em uma etapa futura, depois da revisao manual e com autorizacao explicita.

Nessa etapa futura:

1. Informe um motivo.
2. Marque a confirmacao explicita.
3. Clique em **Criar ajuste administrativo** no workspace correto.

A acao cria um documento novo em `auditAdjustments` e um log imutavel. Ela nao apaga nem sobrescreve dividas antigas. O ID do documento e o `auditId`; por isso, a mesma auditoria nao pode gerar dois ajustes. Identidades ambiguas bloqueiam a acao.

## Limitacoes importantes

- O Firestore nao permite recuperar um documento que ja foi excluido fisicamente e para o qual nao exista backup, exportacao ou log anterior. A auditoria sinaliza essa lacuna, mas nao inventa dados.
- Colecoes conhecidas e confirmadas pelo codigo sao consultadas. Uma colecao antiga que nao exista mais no codigo precisa ser informada antes de ser adicionada ao diagnostico.
- O ajuste administrativo preserva o valor reconstruido e a diferenca como trilha contabil. Ele nao reescreve silenciosamente dividas individuais; qualquer normalizacao por documento deve ser feita por uma migracao separada, idempotente e inicialmente em `dryRun`.

## Validacao local

```bash
npm test
npm run lint
npm run build
```

As regras devem ser validadas no Firebase Emulator antes da publicacao e, depois, implantadas com o comando de deploy de regras usado pelo projeto.
