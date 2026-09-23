# ADR 0001: Modular monolith
Accepted in the approved implementation plan.
Use Next.js web and a worker process sharing domain/database packages and PostgreSQL.
No separate API service, microservices or duplicated workflow logic.
Routes authenticate and delegate; domain services own transactions.

