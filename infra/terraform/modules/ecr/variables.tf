variable "name_prefix" {
  description = "Repositories are named <name_prefix>/<image>."
  type        = string
}

variable "repositories" {
  description = "Images to create repositories for."
  type        = list(string)
  default     = ["api", "web", "console"]
}

variable "kms_key_arn" {
  description = "CMK for repository encryption. Null uses AES256."
  type        = string
  default     = null
}

variable "keep_images" {
  description = "Tagged images kept per repository."
  type        = number
  default     = 30
}

variable "force_delete" {
  description = "Allow destroying a repository that still holds images."
  type        = bool
  default     = false
}
