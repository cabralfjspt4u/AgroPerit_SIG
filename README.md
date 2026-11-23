# AGROPERIT Parcelário

Site para ver no mapa as parcelas e subparcelas de um ficheiro Excel (polígonos do serviço público do IFAP, fundo de satélite) e exportar para **KML**, com um ponto dentro de cada polígono, para abrir no **Google My Maps**.

AGROPERIT – Peritagens & Avaliações · LEADERGREF LDA

## O que faz

- Lê um Excel (.xlsx, .xls, .csv) com as colunas PARCELA e SUBPARCELA (ou "parcela/subparcela" numa só coluna).
- Procura cada subparcela na camada Ocupações do Solo do IFAP e desenha-a no mapa.
- Ao clicar num polígono mostra a tabela de atributos (dados do IFAP + dados do Excel).
- **Exportar KML**: polígonos e pontos em duas camadas. O ponto **não é o centroide**: é o ponto interior mais afastado dos limites, por isso fica sempre dentro da parcela, mesmo em parcelas em U.
- Também descarrega GeoJSON (para QGIS, por exemplo).
- Fundo claro ou escuro, com o logótipo certo para cada um (botão ◐).
- O mapa está sempre orientado a norte e não muda sozinho de vista.

## Publicar no GitHub (passo a passo)

1. Em **github.com**, clique em **New repository** (botão verde ou o "+" no topo).
2. Em *Repository name* escreva `agroperit-parcelario`. Escolha **Public** e clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**.
4. Arraste para a janela **todo o conteúdo desta pasta** (`index.html`, e as pastas `css`, `js`, `assets`, mais `README.md` e `.nojekyll`). Não arraste o ZIP fechado.
5. Em baixo, clique em **Commit changes**.
6. Vá a **Settings → Pages**. Em *Build and deployment*, escolha *Deploy from a branch*, ramo **main**, pasta **/ (root)** e clique em **Save**.
7. Ao fim de 1 a 2 minutos o site fica em `https://SEU-UTILIZADOR.github.io/agroperit-parcelario/`.

Nota: na conta gratuita do GitHub o site só fica publicado a partir de um repositório **público**.

## Abrir no Google My Maps

1. Em **mymaps.google.com**, inicie sessão e clique em **Criar um novo mapa**.
2. Clique em **Importar** e escolha o ficheiro `.kml` descarregado do site.
3. Aparecem as camadas **Polígonos** e **Pontos**. Os dados do Excel e do IFAP ficam na tabela de cada elemento.

## Notas

- Os polígonos vêm do serviço público do IFAP (camada atual). Pode ter mudado desde a campanha do ficheiro.
- O serviço do IFAP pode demorar. A página repete os pedidos que falharem e tem o botão "Repetir as que falharam".
- A imagem de satélite Google é usada sem licença própria: serve para pré-análise. Para uso comercial, confirmar os termos da Google.
- O Excel é lido no próprio computador; só os números de parcela são enviados ao IFAP.
