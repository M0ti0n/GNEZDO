# Build from the repository root (the nesting engine is outside backend/):
#   docker build -f backend/Dockerfile -t gnezdo-api .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/Directory.Build.props ./
COPY backend/src/Gnezdo.Api/Gnezdo.Api.csproj src/Gnezdo.Api/
RUN dotnet restore src/Gnezdo.Api/Gnezdo.Api.csproj
COPY backend/src/ src/
RUN dotnet publish src/Gnezdo.Api/Gnezdo.Api.csproj -c Release -o /app --no-restore

# PackingSolver, built on the same Linux as the image it runs in
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS solver
RUN apt-get update && apt-get install -y --no-install-recommends cmake g++ git ninja-build \
    && rm -rf /var/lib/apt/lists/*
COPY nesting/packingsolver /ps
RUN cmake -S /ps -B /ps/build -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DPACKINGSOLVER_BUILD_TEST=OFF -DPACKINGSOLVER_USE_CLP=OFF -DPACKINGSOLVER_USE_HIGHS=ON \
    && cmake --build /ps/build --target packingsolver_irregular -j4

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# the nesting engine: nestprep runs on Python with numpy
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-numpy libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app ./
COPY --from=solver /ps/build/src/irregular/packingsolver_irregular nesting/
COPY nesting/nestprep/nestprep_cli.py nesting/nestprep/
COPY nesting/nestprep/nestprep/*.py nesting/nestprep/nestprep/
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Gnezdo.Api.dll"]
