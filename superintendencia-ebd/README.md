# Superintendência EBD

Aplicação mobile-first para gestão administrativa da Escola Bíblica Dominical, construída sobre React + Vite + Firebase.

## MVP atual

- Cadastro geral de pessoas (membros, frequentantes e visitantes)
- Cadastro de classes/departamentos
- Matrículas EBD (separadas do cadastro geral)
- Caderneta mensal por classe
- Presença por domingo (ciclo: vazio -> PP -> P -> A)
- Cálculo automático por aluno e resumo geral da turma
- Exportação de PDF da caderneta
- Dashboard inicial com atalhos
- Comunicação básica (WhatsApp, copiar mensagem, ligar)

## Como rodar

```bash
npm install
npm run dev
```

O app também funciona em modo local (mock) quando as credenciais do Firebase não estão configuradas.

## Estrutura principal

```text
src/
  features/
    dashboard/
    people/
    classes/
    enrollments/
    attendance/
    communication/
    reports/
    materials/
    settings/
  components/
    layout/
    ui/
  services/
    ebdDataService.js
    peopleService.js
    classService.js
    enrollmentService.js
    attendanceService.js
    pdfService.js
  utils/
    attendanceUtils.js
```

## Fluxo recomendado de teste

1. Criar pessoas em Pessoas
2. Criar classes em Classes
3. Fazer matrículas em Matrículas
4. Criar caderneta em Caderneta Mensal
5. Marcar presença por domingo
6. Validar cálculos por aluno e resumo da turma
7. Exportar PDF
