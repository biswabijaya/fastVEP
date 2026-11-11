FROM rust:slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY web ./web
RUN cargo build --locked --release -p fastvep-web -p fastvep-cli

FROM debian:bookworm-slim AS references
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl samtools && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/fastvep /usr/local/bin/fastvep
WORKDIR /data/hg38_ensembl_115
RUN curl --fail --retry 3 --connect-timeout 30 --max-time 600 https://ftp.ensembl.org/pub/release-115/gff3/homo_sapiens/Homo_sapiens.GRCh38.115.gff3.gz | gzip -d > genes.gff3 \
 && curl --fail --retry 3 --connect-timeout 30 --max-time 600 https://ftp.ensembl.org/pub/release-115/fasta/homo_sapiens/dna/Homo_sapiens.GRCh38.dna.primary_assembly.fa.gz | gzip -d > reference.fa \
 && samtools faidx reference.fa
RUN mkdir sa && curl --fail --retry 3 --connect-timeout 30 --max-time 600 -o clinvar.vcf.gz https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/clinvar.vcf.gz \
 && fastvep sa-build --source clinvar -i clinvar.vcf.gz -o sa/clinvar --assembly GRCh38 \
 && sha256sum genes.gff3 reference.fa sa/* > SHA256SUMS \
 && rm clinvar.vcf.gz

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/fastvep-web /usr/local/bin/fastvep-web
COPY --from=references /data /data
ENV FASTVEP_BIND=0.0.0.0 FASTVEP_MAX_PARALLEL=2 FASTVEP_MAX_RESPONSE_BYTES=16777216 FASTVEP_STATS_FILE=/tmp/stats.json
USER 65532:65532
CMD ["/bin/sh", "-c", "exec fastvep-web --port \"${PORT:-8080}\" --gff3 /data/hg38_ensembl_115/genes.gff3 --fasta /data/hg38_ensembl_115/reference.fa --sa-dir /data/hg38_ensembl_115/sa --data-dir /data"]
