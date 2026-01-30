# LTX Deployment Summary

## Terraform Modules
*   **VPC**: Creates isolated network.
*   **MIG**: Configures Instance Template (Startup script, GPU drivers) and Manager.
*   **Load Balancer**: Sets up Cloud Armor and HTTPS forwarding.

## Deployment Steps
1.  Configure `terraform.tfvars`.
2.  Run `terraform apply`.
3.  Wait ~15 mins for initial infrastructure + model download.
4.  Retrieve API Key and LB IP from terraform output.