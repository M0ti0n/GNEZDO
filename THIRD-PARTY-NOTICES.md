# Third-party software

GNEZDO is licensed under the GNU Affero General Public License v3.0 (see [LICENSE](LICENSE)). It includes
or uses the following software, each under its own license:

| Component | Used for | License |
|---|---|---|
| [PackingSolver](https://github.com/fontanf/packingsolver) (`nesting/packingsolver`) | the nesting engine | MIT (`nesting/packingsolver/LICENSE`; in the builds `nesting/PACKINGSOLVER_LICENSE`) |
| [HiGHS](https://github.com/ERGO-Code/HiGHS) | linear programming solver, built into PackingSolver | MIT |
| [Python](https://www.python.org/) (bundled with the builds) | runs the nesting preparation (nestprep) | Python Software Foundation License |
| [NumPy](https://numpy.org/) | geometry in nestprep | BSD-3-Clause |
| [.NET](https://dotnet.microsoft.com/) runtime and ASP.NET Core | the GNEZDO program and server | MIT |
| [React](https://react.dev/) and the other npm packages of `frontend/package.json` | the web pages | MIT and similar permissive licenses (in each package) |
| NuGet packages of `backend/src/Gnezdo.Api/Gnezdo.Api.csproj` | database access and the server | MIT and similar permissive licenses (in each package) |
