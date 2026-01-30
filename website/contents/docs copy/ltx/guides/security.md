# LTX Security

## Authentication
*   **API Key**: Requests must include `X-API-Key` header.
*   **Service Accounts**: VMs run with a custom Service Account with minimal privileges (Storage Read/Write, Logging Write).

## Network Security
*   **Cloud Armor**: Protects the Global Load Balancer from DDoS and unauthorized access.
*   **Private VPC**: VMs have no public IP addresses (optional configuration).
*   **SSL/TLS**: Load Balancer handles SSL termination.