-- Migration: atualizar descriptions das skills CDS para reduzir falso-positivos
-- Idempotente: safe to run multiple times (UPDATE apenas altera o texto)

UPDATE skills SET
    description = 'Skill especializada na análise estrutural de CDS Views ABAP (etapas 0–5). Use quando o usuário pedir análise estrutural completa ou iniciar documentação de uma CDS desconhecida. NÃO use para perguntas pontuais sobre campos, annotations ou sintaxe.',
    updated_at  = NOW()
WHERE name = 'cds-structural-analysis';

UPDATE skills SET
    description = 'Skill orquestradora para análise completa e documentação de CDS Views ABAP. Use APENAS para pedidos explícitos de análise completa, documentação técnica ou reverse engineering. NÃO use para perguntas pontuais ou refatorações.',
    updated_at  = NOW()
WHERE name = 'cds-doc-analysis';
