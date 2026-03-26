---
name: cds-clean-core-refactoring
description: >
  Skill especializada em refatoração de CDS Views legadas para o padrão Clean Core do S/4HANA.
  Use esta skill SEMPRE que o usuário mencionar: refatorar CDS, migrar CDS legada, Clean Core, CDS
  custom para released API, wrapper CDS, substituição de CDS Z por CDS SAP standard, análise de
  dependências CDS, blueprint de nova CDS, released objects, C1/C2 released, sucessores de CDS,
  matriz de campos CDS, gap analysis CDS ou qualquer tarefa de modernização de views ABAP/CDS.
  Também deve ser acionada quando o usuário compartilhar código fonte de uma CDS e pedir análise,
  revisão ou sugestão de melhoria seguindo boas práticas SAP S/4HANA.
---

# Skill: Refatoração de CDS Legadas para Clean Core

## Visão Geral

Esta skill conduz um processo estruturado de **8 etapas** para analisar uma CDS View legada,
identificar objetos released equivalentes e produzir um blueprint completo da nova arquitetura
Clean Core, incluindo wrappers onde necessário.

**Abordagem geral:** sempre execute as etapas em ordem. Cada etapa alimenta a próxima.
Se o usuário fornecer apenas o nome da CDS, comece pela Etapa 1. Se já trouxer código-fonte,
pule para a Etapa 2 diretamente.

---

## ETAPA 1 — Extração de Metadados da CDS Legada

**Objetivo:** montar o perfil completo da CDS antes de qualquer análise.

Solicite ao usuário (ou extraia do código-fonte fornecido):

| Metadado | O que capturar |
|---|---|
| Nome da CDS | Ex: `ZSD_ORDERS_HEADER` |
| Tipo | `DEFINE VIEW`, `DEFINE VIEW ENTITY`, `DEFINE ROOT VIEW ENTITY` |
| Anotações principais | `@AbapCatalog`, `@Analytics`, `@OData`, `@ObjectModel` |
| Data Model Category | `#BO_NODE`, `#ANALYTICAL_FACT`, `#BASIC_INTERFACE`, etc. |
| Associações declaradas | Nomes e cardinalidades |
| Parâmetros de entrada | Se existirem |
| Versão ABAP/SAP | ECC, S/4HANA On-Premise, BTP ABAP |

**Output da etapa:** bloco resumo em formato YAML:

```yaml
cds_legada:
  nome: ZSD_ORDERS_HEADER
  tipo: DEFINE VIEW ENTITY
  modulo: SD
  anotacoes_criticas:
    - "@AbapCatalog.sqlViewName: 'ZSDORDH'"
    - "@Analytics.dataCategory: #FACT"
  parametros: []
  total_campos: 42
  total_associacoes: 5
```

---

## ETAPA 2 — Detecção de Tabelas, Campos, Joins e Dependências CDS

**Objetivo:** dissecar a estrutura interna da CDS.

### 2.1 — Tabelas e Joins

Extraia e classifique cada source da query:

```
FONTES DETECTADAS:
┌────────────────────┬────────────┬─────────────┬──────────────────┐
│ Tabela/CDS         │ Tipo       │ Tipo de Join│ Chave de Join     │
├────────────────────┼────────────┼─────────────┼──────────────────┤
│ VBAK               │ Tabela DB  │ FROM (base) │ —                │
│ VBAP               │ Tabela DB  │ INNER JOIN  │ vbeln, posnr     │
│ ZSD_CUSTOM_TEXT    │ CDS Z      │ LEFT JOIN   │ matnr, spras     │
│ I_SalesOrder       │ CDS SAP    │ ASSOCIATION │ SalesOrder       │
└────────────────────┴────────────┴─────────────┴──────────────────┘
```

### 2.2 — Campos Problemáticos

Identifique campos que bloqueiam o Clean Core:

- Campos de tabelas `Z*` ou `Y*` customizadas
- Campos depreciados (verificar via RAG ou `web_search` em SAP Notes)
- Cast types não-padrão ou lógica de CASE complexa
- Campos calculados com funções nativas DB

### 2.3 — CDS Dependentes

Liste todas as CDS que consomem esta view (dependentes downstream).
Pergunte ao usuário ou instrua como obter via SE11/ADT:

```abap
" Para encontrar dependentes no sistema:
" ADT → clique direito na CDS → "Where Used List"
" Ou via tabela DD02L filtrando por VIEWREF
```

---

## ETAPA 3 — Consulta ao Catálogo de Released Objects e Sucessores

**Objetivo:** encontrar os objetos SAP released que substituem tabelas/CDS legadas.

### 3.1 — Protocolo de busca (nesta ordem)

1. **RAG Search** — busque `"released CDS [nome da tabela]"`, `"successor [tabela]"`,
   `"C1 released [módulo]"` na base de conhecimento interna.

2. **Verificação de Release Contract** — explique ao usuário como verificar:

```
No SAP S/4HANA:
→ Transação: /IWBEP/V4_ADM_API  (OData V4 APIs)
→ Transação: AMDP Viewer
→ ADT: abra a CDS → aba "Properties" → campo "Release State"
→ Anotação na CDS: @VDM.viewType: #CONSUMPTION ou #BASIC
→ Release contract: C1 = uso externo permitido / C2 = SAP-interno
```

3. **Web Search** — se RAG for insuficiente, busque:
   - `site:help.sap.com "successor" "[NOME_TABELA]"`
   - `SAP S/4HANA released CDS [nome da tabela] C1`

### 3.2 — Tabela de Released Objects por Domínio

Consulte e preencha para as tabelas identificadas na Etapa 2:

| Tabela Legada | Released CDS Sucessora | Release State | Módulo |
|---|---|---|---|
| VBAK | `I_SalesOrder` | C1 | SD |
| VBAP | `I_SalesOrderItem` | C1 | SD |
| BKPF | `I_JournalEntry` | C1 | FI |
| BSEG | `I_JournalEntryItem` | C1 | FI |
| EKKO | `I_PurchasingDocument` | C1 | MM |
| EKPO | `I_PurchasingDocumentItem` | C1 | MM |
| MSEG | `I_MaterialDocument` | C1 | MM |
| KNA1 | `I_Customer` | C1 | SD/FI |
| LFA1 | `I_Supplier` | C1 | MM/FI |

> 💡 Se a tabela legada não constar acima, execute busca RAG com o nome exato.

---

## ETAPA 4 — Mapeamento de Candidatos por Entidade de Negócio

**Objetivo:** agrupar os released objects encontrados por entidade de negócio lógica.

Para cada entidade identificada, monte um card:

```
╔══════════════════════════════════════════════════════╗
║  ENTIDADE: Sales Order                               ║
╠══════════════════════════════════════════════════════╣
║  CDS Header:    I_SalesOrder          (C1)           ║
║  CDS Item:      I_SalesOrderItem      (C1)           ║
║  CDS Schedule:  I_SalesOrderScheduleLine (C1)        ║
║  CDS Pricing:   I_SalesOrderItemPrcgElmnt (C1)       ║
║  Extensibility: E_SalesOrder (Extension Include)     ║
╠══════════════════════════════════════════════════════╣
║  Campos customizados: via BADI / Extension Fields    ║
║  OData API: API_SALES_ORDER_SRV (C1)                 ║
╚══════════════════════════════════════════════════════╝
```

Repita para cada entidade de negócio coberta pela CDS legada.

---

## ETAPA 5 — Construção da Matriz de Campos

**Objetivo:** mapear cada campo da CDS legada ao seu equivalente no mundo Clean Core.

Gere a matriz completa:

```
MATRIZ DE CAMPOS — ZSD_ORDERS_HEADER
═══════════════════════════════════════════════════════════════════════════════
 # │ Campo Legado      │ Fonte Legada │ Campo Released    │ CDS Released        │ Status
───┼───────────────────┼──────────────┼───────────────────┼─────────────────────┼────────────
 1 │ vbeln             │ VBAK         │ SalesOrder        │ I_SalesOrder        │ ✅ Mapeado
 2 │ erdat             │ VBAK         │ CreationDate      │ I_SalesOrder        │ ✅ Mapeado
 3 │ auart             │ VBAK         │ SalesOrderType    │ I_SalesOrder        │ ✅ Mapeado
 4 │ zz_campo_custom   │ VBAK (append)│ —                 │ —                   │ ⚠️  Gap
 5 │ calc_liquido      │ CASE/CAST    │ NetAmount         │ I_SalesOrderItem    │ ✅ Mapeado
 6 │ txt_material      │ ZSD_TEXT (Z) │ MaterialName      │ I_ProductDescription│ ✅ Mapeado
 7 │ campo_obsoleto    │ VBAK         │ —                 │ Depreciado          │ ❌ Sem sucessor
═══════════════════════════════════════════════════════════════════════════════

LEGENDA:
✅ Mapeado      → campo encontrado em released object
⚠️  Gap          → campo custom / sem equivalente direto
❌ Sem sucessor → campo depreciado sem substituto SAP
🔄 Parcial      → campo existe mas com semântica diferente
```

---

## ETAPA 6 — Construção da Matriz de Relacionamentos

**Objetivo:** mapear cada JOIN/ASSOCIATION da CDS legada para o equivalente released.

```
MATRIZ DE RELACIONAMENTOS
═══════════════════════════════════════════════════════════════════════════════
 Join Legado                          │ Equivalente Released          │ Mudança
──────────────────────────────────────┼───────────────────────────────┼─────────────────────
 VBAK ──INNER JOIN──► VBAP            │ I_SalesOrder._Item            │ ASSOCIATION nativa
 VBAK ──LEFT JOIN───► VBUK (status)   │ I_SalesOrder._ProcessStatus   │ ASSOCIATION nativa
 VBAK ──LEFT JOIN───► ZSD_Z_TEXT      │ I_SalesOrder._Text            │ CDS Z → Released
 VBAK ──LEFT JOIN───► T001 (empresa)  │ I_SalesOrder.CompanyCode      │ Campo já incluso
 VBAP ──INNER JOIN──► MARA            │ I_SalesOrderItem._Product     │ ASSOCIATION nativa
═══════════════════════════════════════════════════════════════════════════════

OBSERVAÇÕES:
• Associações nativas das released CDS substituem JOINs explícitos
• Usar _Association em vez de JOIN melhora performance (lazy evaluation)
• Joins para tabelas Z precisam de análise individual (ver Etapa 7)
```

---

## ETAPA 7 — Classificação de Gaps e Necessidade de Wrapper

**Objetivo:** decidir a estratégia de tratamento para cada gap identificado.

### 7.1 — Classificação dos Gaps

Para cada campo/relação marcado como `⚠️ Gap` ou `❌` na Etapa 5:

| Gap | Tipo | Estratégia Recomendada |
|---|---|---|
| Campo append `ZZ_*` em tabela SAP | Extension Field | Usar `EXTEND VIEW ENTITY` com Extension Include |
| Lógica de negócio custom (CASE/CALC) | Business Logic | Mover para ABAP Class / Function Module; expor via CDS Param ou Auxiliary Field |
| Tabela Z inteira como fonte | Custom Entity | Criar `Custom CDS View Entity` sobre a tabela Z; associar à released |
| Campo sem sucessor (depreciado) | Obsoleto | Consultar usuário: pode ser removido ou requer workaround |
| Join para dado externo ao S/4HANA | External | Usar Federation / Virtual Data Model se disponível |

### 7.2 — Decisão de Wrapper

Determine se a nova CDS precisará de wrapper:

```
PRECISA DE WRAPPER se:
  ✓ A released CDS não expõe todos os campos necessários
  ✓ Há campos de extensão (ZZ_*) a incluir
  ✓ Há múltiplas released CDS a combinar
  ✓ A CDS será consumida por relatório/OData já existente (compatibilidade)
  ✓ Há cálculos ou conversões que não existem na released

NÃO PRECISA DE WRAPPER se:
  ✓ A released CDS cobre 100% dos campos necessários
  ✓ Não há campos customizados
  ✓ O consumidor pode ser migrado para apontar diretamente à released
```

### 7.3 — Tipo de Wrapper a Criar

```
TIPO C (Consumption View) → para relatórios/Fiori/OData
TIPO R (Restricted Reuse) → para uso interno entre CDS da mesma aplicação
TIPO I (Interface View)   → se outros objetos Z vão consumir esta CDS
```

---

## ETAPA 8 — Blueprint da Nova CDS

**Objetivo:** produzir o design completo e o código da nova arquitetura.

### 8.1 — Diagrama da Nova Arquitetura

```
BLUEPRINT: ZC_SD_ORDERS_HEADER (nova CDS Clean Core)

  ┌─────────────────────────────────────────────────────┐
  │           ZC_SD_ORDERS_HEADER                       │
  │         (Consumption View - Wrapper)                │
  │  @VDM.viewType: #CONSUMPTION                        │
  │  @AccessControl.authorizationCheck: #CHECK          │
  └──────────────────┬──────────────────────────────────┘
                     │ SELECT FROM
  ┌──────────────────▼──────────────────────────────────┐
  │              I_SalesOrder (C1 Released)             │
  │         + _Item (Association)                       │
  │         + _ProcessStatus (Association)              │
  └──────────────────┬──────────────────────────────────┘
                     │ EXTEND VIEW ENTITY (campos ZZ_*)
  ┌──────────────────▼──────────────────────────────────┐
  │        E_SalesOrder (Extension Include)             │
  │  Campos: ZZ_CAMPO_CUSTOM                            │
  └─────────────────────────────────────────────────────┘
```

### 8.2 — Código da Nova CDS

Gere o código completo com anotações Clean Core:

```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Sales Order Header - Clean Core'
@Metadata.ignorePropagatedAnnotations: true

@VDM.viewType: #CONSUMPTION

@ObjectModel.usageType:{
  serviceQuality: #A,
  sizeCategory: #M,
  dataClass: #TRANSACTIONAL
}

define view entity ZC_SD_ORDERS_HEADER
  as select from I_SalesOrder

  -- Associações herdadas da released (não recriar como JOINs)
  association [0..*] to I_SalesOrderItem          as _Item           on $projection.SalesOrder = _Item.SalesOrder
  association [0..1] to I_SalesOrderProcessStatus as _ProcessStatus  on $projection.SalesOrder = _ProcessStatus.SalesOrder

{
  -- Campos da Released (mapeamento da Matriz de Campos - Etapa 5)
  key SalesOrder,
      SalesOrderType,
      SalesOrganization,
      CreationDate,
      NetAmount,
      TransactionCurrency,

  -- Campos de extensão (GAPs da Etapa 7)
  -- Nota: campos ZZ_ acessados via Extension Include
      _Extension.ZZ_CAMPO_CUSTOM,

  -- Associações expostas
      _Item,
      _ProcessStatus
}
```

### 8.3 — Wrapper para Extensão de Campos (se necessário)

```abap
-- Extension Include para campos customizados
extend view entity I_SalesOrder with ZX_SD_SALESORDER_EXT
{
  sap_extension_field ZZ_CAMPO_CUSTOM;
}
```

### 8.4 — Checklist de Validação Clean Core

Antes de finalizar o blueprint, confirme:

```
CHECKLIST CLEAN CORE
─────────────────────────────────────────────────────────
[ ] Nenhuma tabela de banco de dados SAP acessada diretamente
    (todas via released CDS C1)
[ ] Nenhuma tabela Z acessada diretamente no SELECT principal
    (tabelas Z isoladas em Custom CDS ou Extension)
[ ] Anotação @AccessControl configurada (#CHECK ou #NOT_REQUIRED justificado)
[ ] @VDM.viewType declarado corretamente
[ ] Campos deprecated removidos ou substituídos
[ ] Código ABAP customizado movido para extensibilidade oficial
    (BAdI, Extension Fields, ABAP Cloud APIs)
[ ] Released CDS usadas têm contrato C1 (verificado na Etapa 3)
[ ] Nomes seguem convenção: ZI_ (Interface), ZC_ (Consumption), ZR_ (Restricted)
─────────────────────────────────────────────────────────
```

### 8.5 — Resumo Executivo do Blueprint

Ao final, produza um resumo para o usuário:

```
╔═══════════════════════════════════════════════════════════════╗
║              RESUMO DO BLUEPRINT CLEAN CORE                   ║
╠═══════════════════════════════════════════════════════════════╣
║  CDS Legada:        ZSD_ORDERS_HEADER                         ║
║  Nova CDS:          ZC_SD_ORDERS_HEADER                       ║
║  Tipo:              Consumption View (Wrapper)                ║
╠═══════════════════════════════════════════════════════════════╣
║  CAMPOS                                                       ║
║  Total legado:      42   Mapeados: 38   Gaps: 3   Obsoletos: 1║
╠═══════════════════════════════════════════════════════════════╣
║  RELACIONAMENTOS                                              ║
║  JOINs eliminados:  5    Substituídos por Associations: 5     ║
╠═══════════════════════════════════════════════════════════════╣
║  ESTRATÉGIA DE GAPS                                           ║
║  Extension Fields:  2    Custom CDS:  1    Removidos:  1      ║
╠═══════════════════════════════════════════════════════════════╣
║  RELEASED OBJECTS UTILIZADOS                                  ║
║  I_SalesOrder, I_SalesOrderItem, I_SalesOrderProcessStatus    ║
╠═══════════════════════════════════════════════════════════════╣
║  ESFORÇO ESTIMADO   Baixo □  Médio ■  Alto □                 ║
║  RISCO TÉCNICO      Baixo □  Médio ■  Alto □                 ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## Referências para RAG Search

Use estas queries no `rag_search` ao longo das etapas:

- `"released CDS [módulo] C1"`
- `"Clean Core extensibility [módulo]"`
- `"successor [nome da tabela]"`
- `"Extension Include S/4HANA"`
- `"ABAP Cloud API [módulo]"`
- `"VDM view type consumption interface"`
- `"wrapper CDS [entidade de negócio]"`
- `"@ObjectModel.usageType"`
- `"CDS Access Control dcl"`

Se o RAG retornar resultados insuficientes em qualquer etapa, use `web_search` com:
- `site:help.sap.com "released" "[tabela ou CDS]"`
- `SAP S/4HANA clean core CDS successor [tabela]`
- `SAP Note [número] [tabela depreciada]`