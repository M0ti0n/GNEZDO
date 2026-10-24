# Build: docker build -t gnezdo-api backend
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY src/Gnezdo.Api/Gnezdo.Api.csproj src/Gnezdo.Api/
RUN dotnet restore src/Gnezdo.Api/Gnezdo.Api.csproj
COPY src/ src/
RUN dotnet publish src/Gnezdo.Api/Gnezdo.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Gnezdo.Api.dll"]
